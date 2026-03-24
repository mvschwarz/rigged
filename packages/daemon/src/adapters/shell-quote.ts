/** Shell-quote a string using single quotes (POSIX-safe). */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}
