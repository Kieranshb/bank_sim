// Money is an integer number of cents everywhere in the system. Floats never touch an amount.
// Parse once at the edge (channel adapters), format only for humans (messages, logs).

export type Cents = number;

// "$32,500", "15000", "15000.5" -> 3250000, 1500000, 1500050. Pure string arithmetic, no floats.
export function dollarsToCents(text: string): Cents {
  const cleaned = text.replace(/[$,\s]/g, '');
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid dollar amount "${text}"`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

// 3250000 -> "$32,500", 1500050 -> "$15,000.50"
export function formatCents(cents: Cents): string {
  const dollars = Math.trunc(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const remainder = cents % 100;
  return `$${dollars}${remainder ? `.${String(remainder).padStart(2, '0')}` : ''}`;
}
