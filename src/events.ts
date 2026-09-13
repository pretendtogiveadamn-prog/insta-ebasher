import { EventEmitter } from "node:events";
export class Events { private e = new EventEmitter(); emit() { this.e.emit("change"); } on(fn: () => void) { this.e.on("change", fn); return () => this.e.off("change", fn); } }
