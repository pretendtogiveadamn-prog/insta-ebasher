#!/usr/bin/env node
// ih — insta-ebasher-v2 CLI. Phase 0: doctor/selfcheck/accounts/leads/stats живые;
// send/classify/run — гейты Phase 2+ (fail-closed, не молча).
import { program } from "commander";
import { cmdDoctor } from "./src/cli/doctor.mjs";
import { cmdSelfcheck } from "./src/cli/selfcheck.mjs";
import { cmdAccounts } from "./src/cli/accounts.mjs";
import { cmdLeads } from "./src/cli/leads.mjs";
import { cmdStats } from "./src/cli/stats.mjs";
import { cmdDood } from "./src/cli/dood.mjs";
import { cmdSend } from "./src/cli/send.mjs";
import { cmdClassify } from "./src/cli/classify.mjs";
import { cmdMail } from "./src/cli/mail.mjs";
import { cmdAudit } from "./src/cli/audit.mjs";

program
  .name("ih")
  .description("insta-ebasher-v2 — IG outreach движок (браузер=руки, LLM=мозг)")
  .version("0.1.0");

program.command("doctor").description("панель/CDP pool/proxy/db/llm креды").action(cmdDoctor);
program
  .command("selfcheck")
  .argument("<profile>", "anty profile id или name")
  .option("--country <code>", "ожидаемая geo", "US")
  .description("fingerprint-selfcheck (7 пунктов, spec 01 §2)")
  .action((profile, opts) => cmdSelfcheck(profile, opts));
program
  .command("accounts")
  .argument("[action]", "list|add|pause|cap")
  .argument("[id]", "account id (pause/cap)")
  .option("--label <s>")
  .option("--anty-profile <s>")
  .option("--username <s>")
  .option("--cap <n>", "daily cap")
  .option("--value <s>", "значение для pause/cap")
  .description("управление аккаунтами (Anty-профиль = аккаунт)")
  .action((action, id, opts) => cmdAccounts(action, id, opts));
program
  .command("leads")
  .argument("[action]", "list|add|status|evidence")
  .argument("[id]", "lead id (status)")
  .option("--handle <s>")
  .option("--artist <s>")
  .option("--track <s>")
  .option("--source <s>", "artistconnect|manual|youtube")
  .option("--beat <s>", "beat_ref")
  .option("--draft <text>", "текст первого DM (точно как уйдёт)")
  .option("--value <s>", "новый статус")
  .option("--status <s>", "фильтр list")
  .description("лиды: exact handle побуквенно (TRAPS #5)")
  .action((action, id, opts) => cmdLeads(action, id, opts));
program
  .command("classify")
  .option("--limit <n>", "сколько лидов", "20")
  .description("LLM-слой (research→classify→compose) — только вердикты, не шлём (IH_CLASSIFY_ONLY)")
  .action((opts) => cmdClassify(opts));
program
  .command("send")
  .option("--lead-id <s>")
  .option("--account <s>")
  .option("--dry-run", "полный флоу до S8 CONFIRM без отправки")
  .option("--canary <leadId>", "canary: один лид, полный флоу")
  .description("DM-flow по лиду (spec 02) — dry-run разрешён с pending-контрактами, live требует verified")
  .action((opts) => cmdSend(opts));
program
  .command("mail")
  .option("--v1 <url>", "v1 backend base url (или env IH_V1_URL)")
  .option("--account <s>", "v2 account id/label/username (дефолт: первый enabled)")
  .option("--max <n>", "макс DM за прогон", "10")
  .option("--dry-run", "не жать Send даже если v1 в live")
  .option("--canary", "bootstrap live: 1 DM, send-confirm зона верифицируется этим прогоном")
  .description("рассылка по v1-lease: v1 выбирает цель+текст, v2-движок исполняет через Anty")
  .action((opts) => cmdMail(opts));
program
  .command("audit")
  .argument("<handle>", "IG handle профиля для аудита")
  .option("--thread", "открыть тред (клик Message) и аудировать thread/send-confirm зоны")
  .option("--apply", "пометить matched элементы verified в contracts/*.yaml")
  .option("--draft <text>", "текст для send-confirm/our_message_bubble (после отправки)")
  .option("--account <s>", "v2 account id/label/username")
  .option("--mark-zone <zone>", "bootstrap: пометить ВСЮ зону verified (детект-зоны, с --evidence)")
  .option("--evidence <ref>", "ссылка на evidence (dry-run/canary jobId) для code-элементов и --mark-zone")
  .description("live контракт-аудит IG: резолвит зоны на живом DOM, evidence, --apply верифицирует")
  .action((handle, opts) => cmdAudit(handle, opts));
program
  .command("run")
  .description("scheduler daemon (Phase 4) — сейчас рассылка через `ih mail`")
  .action(() => {
    console.log("run: Phase 4 (спека specs/04). Сейчас рассылка: ih mail --v1 <url> --account <id>");
    process.exitCode = 2;
  });
program
  .command("stats")
  .option("--days <n>", "окно дней", "7")
  .description("sent/reply-rate/outcome по аккаунтам")
  .action((opts) => cmdStats(Number(opts.days)));
program
  .command("evidence")
  .argument("<leadId>")
  .description("путь к скринам лида")
  .action((leadId) => cmdLeads("evidence", leadId, {}));
program
  .command("dood")
  .description("DoD-харнесс: gate-чеклист Phase 0")
  .action(cmdDood);

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
