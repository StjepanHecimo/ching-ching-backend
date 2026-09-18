export type CustomerLanguageCode = "hr" | "en";

export function customerLanguageCode(
  value?: string | null,
): CustomerLanguageCode {
  return value?.trim().toLowerCase() === "en" ? "en" : "hr";
}

export function isEnglishCustomer(value?: string | null) {
  return customerLanguageCode(value) === "en";
}

export function customerLocale(value?: string | null) {
  return isEnglishCustomer(value) ? "en-US" : "hr-HR";
}
