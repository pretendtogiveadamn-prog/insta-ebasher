import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";

const originalCountry = process.env.PHONE_DEFAULT_COUNTRY;
afterEach(() => { if (originalCountry === undefined) delete process.env.PHONE_DEFAULT_COUNTRY; else process.env.PHONE_DEFAULT_COUNTRY = originalCountry; });

describe("US phone policy", () => {
  it("always uses +1 even when an obsolete environment variable is present", () => {
    process.env.PHONE_DEFAULT_COUNTRY = "+7";
    expect(config().country).toBe("+1");
  });
});
