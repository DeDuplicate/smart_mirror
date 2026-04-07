import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Keyboard Layouts ───────────────────────────────────────────────────────

const HEBREW_ROWS = [
  ['/', "'", 'ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'],
  ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
  ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'],
];

const ENGLISH_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const NUMBER_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '$', '%', '&', '-', '+', '(', ')'],
  ['!', '"', '*', "'", ':', ';', ',', '.', '?'],
];

const EMOJI_ROWS = [
  ['😀', '😂', '❤️', '👍', '🎉', '🔥', '✨', '💪', '🙏', '😊'],
  ['🏠', '🛒', '🧹', '🍽️', '👕', '🚿', '📚', '💊', '🐕', '🌿'],
  ['⭐', '✅', '❌', '⏰', '📅', '🎵', '📱', '💡', '🔑', '🚗'],
];

// ─── Key Component ──────────────────────────────────────────────────────────

function Key({ label, onPress, flex = 1, variant = 'default', icon, ariaLabel }) {
  const [pressed, setPressed] = useState(false);

  const variants = {
    default: 'bg-surf border-bd text-tp',
    special: 'bg-s2 border-bd text-ts',
    accent: 'bg-acc border-acc text-white',
  };

  return (
    <button
      aria-label={ariaLabel || label || undefined}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => {
        setPressed(false);
        onPress();
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => {
        setPressed(false);
        onPress();
      }}
      onMouseLeave={() => setPressed(false)}
      className={`
        ${variants[variant]}
        border rounded-lg
        flex items-center justify-center
        min-w-[48px] h-[52px]
        font-heebo font-medium text-base
        select-none transition-transform
        active:brightness-90
      `}
      style={{
        flex,
        transform: pressed ? 'scale(0.95)' : 'scale(1)',
        transitionDuration: 'var(--dur-fast)',
      }}
    >
      {icon || label}
    </button>
  );
}

// ─── Backspace Key with hold-to-repeat ──────────────────────────────────────

function BackspaceKey({ onBackspace }) {
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const [pressed, setPressed] = useState(false);

  const startRepeat = useCallback(() => {
    setPressed(true);
    onBackspace();
    // Start repeating after 500ms, then accelerate
    timeoutRef.current = setTimeout(() => {
      let delay = 150;
      const repeat = () => {
        onBackspace();
        delay = Math.max(50, delay - 10);
        intervalRef.current = setTimeout(repeat, delay);
      };
      intervalRef.current = setTimeout(repeat, delay);
    }, 500);
  }, [onBackspace]);

  const stopRepeat = useCallback(() => {
    setPressed(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearTimeout(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, []);

  const backspaceIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );

  return (
    <button
      aria-label="מחיקה"
      onTouchStart={startRepeat}
      onTouchEnd={stopRepeat}
      onTouchCancel={stopRepeat}
      onMouseDown={startRepeat}
      onMouseUp={stopRepeat}
      onMouseLeave={stopRepeat}
      className="
        bg-s2 border border-bd text-ts rounded-lg
        flex items-center justify-center
        min-w-[48px] h-[52px]
        select-none transition-transform
        active:brightness-90
      "
      style={{
        flex: 1.3,
        transform: pressed ? 'scale(0.95)' : 'scale(1)',
        transitionDuration: 'var(--dur-fast)',
      }}
    >
      {backspaceIcon}
    </button>
  );
}

// ─── OnScreenKeyboard Component ─────────────────────────────────────────────

export default function OnScreenKeyboard({
  onInput,
  onBackspace,
  onEnter,
  onClose,
  visible,
}) {
  const [lang, setLang] = useState('he'); // 'he' | 'en'
  const [shifted, setShifted] = useState(false);
  const [numberMode, setNumberMode] = useState(false);
  const [emojiMode, setEmojiMode] = useState(false);

  // Toggle language
  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === 'he' ? 'en' : 'he'));
    setShifted(false);
    setNumberMode(false);
  }, []);

  // Handle character input
  const handleChar = useCallback(
    (char) => {
      if (lang === 'en' && shifted) {
        onInput(char.toUpperCase());
        setShifted(false);
      } else {
        onInput(char);
      }
    },
    [lang, shifted, onInput]
  );

  if (!visible) return null;

  // Determine which rows to show
  let rows;
  if (emojiMode) {
    rows = EMOJI_ROWS;
  } else if (numberMode) {
    rows = NUMBER_ROWS;
  } else if (lang === 'he') {
    rows = HEBREW_ROWS;
  } else {
    rows = ENGLISH_ROWS;
  }

  // Icons
  const langIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );

  const enterIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M9 10l-5 5 5 5" />
      <path d="M20 4v7a4 4 0 01-4 4H4" />
    </svg>
  );

  const shiftIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ direction: 'ltr' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-tp/20"
        onClick={onClose}
        style={{
          animation: 'fadeIn var(--dur-fast) var(--ease) forwards',
        }}
      />

      {/* Keyboard panel */}
      <div
        className="relative bg-s2 border-t border-bd px-3 pb-4 pt-3"
        style={{
          height: '40%',
          animation: 'keyboardSlideUp var(--dur-normal) var(--ease-out) forwards',
        }}
      >
        {/* Key rows */}
        <div className="flex flex-col gap-2 h-full justify-center max-w-[900px] mx-auto">
          {/* Character rows */}
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-1.5 justify-center">
              {/* Shift key on last row for English mode */}
              {rowIndex === 2 && lang === 'en' && !numberMode && (
                <Key
                  label=""
                  icon={shiftIcon}
                  onPress={() => setShifted((s) => !s)}
                  flex={1.3}
                  variant={shifted ? 'accent' : 'special'}
                  ariaLabel={shifted ? 'Shift פעיל' : 'Shift'}
                />
              )}

              {row.map((char) => {
                const displayChar =
                  lang === 'en' && shifted && !numberMode
                    ? char.toUpperCase()
                    : char;
                return (
                  <Key
                    key={char}
                    label={displayChar}
                    onPress={() => handleChar(char)}
                  />
                );
              })}

              {/* Backspace on last row for Hebrew and number modes */}
              {rowIndex === 2 && (lang === 'he' || numberMode) && (
                <BackspaceKey onBackspace={onBackspace} />
              )}

              {/* Backspace on last row for English mode */}
              {rowIndex === 2 && lang === 'en' && !numberMode && (
                <BackspaceKey onBackspace={onBackspace} />
              )}
            </div>
          ))}

          {/* Bottom row: lang toggle, optional 123/ABC, space, enter */}
          <div className="flex gap-1.5 justify-center">
            {/* Language toggle */}
            <Key
              label={lang === 'he' ? 'EN' : 'עב'}
              icon={langIcon}
              onPress={toggleLang}
              flex={1.2}
              variant="special"
              ariaLabel={lang === 'he' ? 'עבור לאנגלית' : 'עבור לעברית'}
            />

            {/* Number mode toggle */}
            <Key
              label={numberMode ? (lang === 'he' ? 'אב' : 'ABC') : '123'}
              onPress={() => { setNumberMode((m) => !m); setEmojiMode(false); }}
              flex={1.2}
              variant="special"
              ariaLabel={numberMode ? 'מצב אותיות' : 'מצב מספרים וסימנים'}
            />

            {/* Emoji toggle */}
            <Key
              label={emojiMode ? (lang === 'he' ? 'אב' : 'ABC') : '😀'}
              onPress={() => { setEmojiMode((m) => !m); setNumberMode(false); }}
              flex={1.2}
              variant={emojiMode ? 'accent' : 'special'}
              ariaLabel={emojiMode ? 'מצב אותיות' : 'מצב אמוג\'י'}
            />

            {/* Space bar */}
            <Key
              label=" "
              onPress={() => onInput(' ')}
              flex={5}
              ariaLabel="רווח"
            />

            {/* Enter / Done */}
            <Key
              label=""
              icon={enterIcon}
              onPress={onEnter}
              flex={1.5}
              variant="accent"
              ariaLabel="אישור"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
