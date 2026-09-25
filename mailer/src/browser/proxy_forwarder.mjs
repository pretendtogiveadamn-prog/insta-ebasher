import http from "node:http";
import net from "node:net";

// Перенос из gmail-farm lib/proxy_forwarder.mjs (проверен в проде фермы).
// Локальный авторизующий форвард-прокси: Chrome/клиент идёт на 127.0.0.1 без
// кредов, авторизация добавляется к upstream (HTTP с auth или SOCKS5 user/pass).

function socksConnect(upstream, targetHost, targetPort, username, password) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let stage = "greet";
    let replyTotal = 0;

    const fail = (err) => { cleanup(); reject(new Error(`socks5: ${err}`)); };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try { step(); } catch (e) { fail(e.message); }
    };
    const onErr = (e) => fail(e.message);
    const cleanup = () => { upstream.off("data", onData); upstream.off("error", onErr); };

    const step = () => {
      if (stage === "greet") {
        if (buf.length < 2) return;
        if (buf[0] !== 5) throw new Error("bad version");
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === 0x02) {
          const u = Buffer.from(username || "");
          const p = Buffer.from(password || "");
          upstream.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
          stage = "auth";
        } else if (method === 0x00) {
          sendRequest();
        } else throw new Error(`no acceptable auth (0x${method.toString(16)})`);
      } else if (stage === "auth") {
        if (buf.length < 2) return;
        const ok = buf[1] === 0;
        buf = buf.subarray(2);
        if (!ok) throw new Error("auth rejected");
        sendRequest();
      } else if (stage === "reply") {
        if (!replyTotal) {
          if (buf.length < 5) return;
          const atyp = buf[3];
          const addrLen = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 ? 1 + buf[4] : 0;
          if (!addrLen) throw new Error(`bad atyp 0x${atyp.toString(16)}`);
          replyTotal = 4 + addrLen + 2;
        }
        if (buf.length < replyTotal) return;
        const rep = buf[1];
        buf = Buffer.alloc(0);
        cleanup();
        if (rep !== 0) reject(new Error(`connect failed, reply=0x${rep.toString(16)}`));
        else resolve();
      }
    };
    const sendRequest = () => {
      const h = Buffer.from(targetHost);
      upstream.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h,
        Buffer.from([(targetPort >> 8) & 255, targetPort & 255]),
      ]));
      stage = "reply";
      step();
    };

    upstream.on("data", onData);
    upstream.on("error", onErr);
    upstream.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
  });
}

export function createProxyForwarder({ host, port, username, password, socks }) {
  const basic = username ? "Basic " + Buffer.from(`${username}:${password || ""}`).toString("base64") : null;
  const upstreamPort = Number(port) || 80;

  const openUpstream = (targetHost, targetPort) =>
    new Promise((resolve, reject) => {
      const upstream = net.connect(upstreamPort, host, async () => {
        if (socks) {
          try { await socksConnect(upstream, targetHost, targetPort, username, password); resolve(upstream); }
          catch (e) { upstream.destroy(); reject(e); }
        } else resolve(upstream);
      });
      upstream.on("error", reject);
    });

  const server = http.createServer(async (req, res) => {
    let targetHost = null, targetPort = 80, path = req.url;
    if (socks) {
      try { const u = new URL(req.url); targetHost = u.hostname; targetPort = Number(u.port) || 80; path = u.pathname + u.search; }
      catch { return res.destroy(); }
    }
    let upstream;
    try { upstream = await openUpstream(targetHost, targetPort); }
    catch { return res.destroy(); }
    const headers = { ...req.headers, Connection: "close" };
    delete headers["proxy-connection"];
    if (socks) {
      delete headers["host"];
      headers["Host"] = targetPort === 80 ? targetHost : `${targetHost}:${targetPort}`;
    }
    if (basic && !socks) headers["Proxy-Authorization"] = basic; else delete headers["Proxy-Authorization"];
    if (socks) {
      // SOCKS: туннель до origin; response парсит Node (createConnection на готовый сокет),
      // raw-pipe дублировал статус-строку в тело (двойной HTTP)
      upstream.destroy();
      const proxyReq = http.request(
        {
          method: req.method,
          path,
          headers,
          createConnection: (opts, cb) => {
            openUpstream(targetHost, targetPort).then(
              (sock) => cb(null, sock),
              (err) => cb(err)
            );
          },
        },
        (pres) => {
          const h = { ...pres.headers };
          delete h["connection"];
          res.writeHead(pres.statusCode ?? 502, h);
          pres.pipe(res);
        }
      );
      proxyReq.on("error", () => res.destroy());
      req.pipe(proxyReq);
    } else {
      // plain HTTP-прокси: ходим как клиент прокси (Node сам парсит ответ,
      // raw-pipe дублировал заголовки/chunked-маркеры в тело — баг при ip-api пробе)
      upstream.destroy();
      const proxyReq = http.request(
        { host, port: upstreamPort, method: req.method, path: req.url, headers },
        (pres) => {
          const h = { ...pres.headers };
          for (const hop of ["connection", "keep-alive", "transfer-encoding", "proxy-authenticate", "proxy-authorization"]) delete h[hop];
          res.writeHead(pres.statusCode ?? 502, h);
          pres.pipe(res);
        }
      );
      proxyReq.on("error", () => res.destroy());
      req.pipe(proxyReq);
    }
  });

  server.on("connect", async (req, clientSocket, head) => {
    const [targetHost, targetPortStr] = (req.url || ":").split(":");
    const targetPort = Number(targetPortStr) || 443;
    let upstream;
    try { upstream = await openUpstream(targetHost, targetPort); }
    catch (e) {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.end();
      return;
    }
    if (socks) {
      clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    } else {
      let cmd = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (basic) cmd += `Proxy-Authorization: ${basic}\r\n`;
      cmd += "\r\n";
      upstream.write(cmd);
    }
    let responded = socks;
    if (!socks) upstream.once("data", (chunk) => {
      const statusLine = chunk.toString("latin1").split("\r\n")[0] || "";
      if (/ 200 /.test(statusLine)) {
        responded = true;
        clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      } else {
        responded = true;
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.end();
        upstream.destroy();
      }
    });
    upstream.on("error", () => { if (!responded) { responded = true; clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); clientSocket.end(); } });
    clientSocket.on("error", () => upstream.destroy());
    upstream.on("end", () => { if (!clientSocket.destroyed) clientSocket.end(); });
  });

  const ready = new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return { ready, close: () => server.close() };
}
