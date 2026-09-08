// Hebrew calendar date formatting in Hebrew numerals (gematria).
// Shared by the TopBar and the screensaver so both render the same string.

const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

/** Number → Hebrew numeral, e.g. 22 → כ״ב */
export function toHebrewNumeral(n) {
  // 15 and 16 are written ט״ו / ט״ז to avoid spelling divine names.
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  if (n <= 0) return '';

  let result = '';
  if (n >= 100) {
    result += HEBREW_HUNDREDS[Math.floor(n / 100)];
    n %= 100;
  }
  if (n >= 10) {
    result += HEBREW_TENS[Math.floor(n / 10)];
    n %= 10;
  }
  if (n > 0) {
    result += HEBREW_ONES[n];
  }

  if (result.length === 1) {
    result += '׳';
  } else if (result.length > 1) {
    result = result.slice(0, -1) + '״' + result.slice(-1);
  }
  return result;
}

/** Hebrew year → letters, e.g. 5786 → ה׳תשפ״ו */
export function toHebrewYear(year) {
  const thousands = Math.floor(year / 1000);
  const remainder = year % 1000;

  let yearStr =
    HEBREW_HUNDREDS[Math.floor(remainder / 100)] +
    HEBREW_TENS[Math.floor((remainder % 100) / 10)] +
    HEBREW_ONES[remainder % 10];

  if (yearStr.length > 1) {
    yearStr = yearStr.slice(0, -1) + '״' + yearStr.slice(-1);
  }
  return HEBREW_ONES[thousands] + '׳' + yearStr;
}

/**
 * Full Hebrew calendar date for `date`, e.g. "כ״ה אלול ה׳תשפ״ו".
 * Returns the parts too, so callers can lay the year out separately.
 */
export function getHebrewDateParts(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(date);

    const dayNum = parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const yearNum = parseInt(parts.find((p) => p.type === 'year')?.value || '0', 10);

    const day = toHebrewNumeral(dayNum);
    const year = yearNum ? toHebrewYear(yearNum) : '';

    return {
      day,
      month,
      year,
      dayMonth: `${day} ${month}`.trim(),
      full: `${day} ${month} ${year}`.trim(),
    };
  } catch {
    return { day: '', month: '', year: '', dayMonth: '', full: '' };
  }
}
