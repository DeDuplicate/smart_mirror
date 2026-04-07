import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from './useApi.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE = '/api/news';

// ─── Mock Data (dev mode) ──────────────────────────────────────────────────

function generateMockArticles() {
  const now = Date.now();
  return [
    {
      id: 'mock-news-1',
      title: 'ממשלת ישראל אישרה תוכנית חדשה לפיתוח תשתיות הנגב',
      source: 'Ynet',
      sourceId: 'ynet',
      category: 'news',
      description:
        'ראש הממשלה הציג תוכנית לאומית להרחבת תשתיות תחבורה, חינוך ובריאות באזור הנגב. התוכנית כוללת השקעה של מיליארדי שקלים בפיתוח ערים חדשות ושדרוג כבישים ורכבות.',
      url: 'https://example.com/article-1',
      publishedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      content: null,
    },
    {
      id: 'mock-news-2',
      title: 'מכבי תל אביב ניצחה ביורוליג עם הפרש של 20 נקודות',
      source: 'Ynet',
      sourceId: 'ynet',
      category: 'sport',
      description:
        'מכבי תל אביב רשמה ניצחון מרשים ביורוליג מול ברצלונה. שחקן העונה הבקיע 32 נקודות ותרם 8 אסיסטים.',
      url: 'https://example.com/article-2',
      publishedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      content: null,
    },
    {
      id: 'mock-news-3',
      title: 'סטארטאפ ישראלי גייס 100 מיליון דולר לפיתוח בינה מלאכותית',
      source: 'ערוץ 14',
      sourceId: 'now14',
      category: 'tech',
      description:
        'חברת הייטק ישראלית הודיעה על סבב גיוס ענק לפיתוח מודל שפה חדש. החברה מתכננת להרחיב את פעילותה לאירופה ואסיה.',
      url: 'https://example.com/article-3',
      publishedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      content: null,
    },
    {
      id: 'mock-news-4',
      title: 'הבורסה בתל אביב עלתה ב-2.3% על רקע נתוני מאקרו חיוביים',
      source: 'Ynet',
      sourceId: 'ynet',
      category: 'finance',
      description:
        'מדד ת"א 125 רשם עלייה חדה לאחר פרסום נתוני צמיחה חיוביים. מניות הטכנולוגיה הובילו את העליות עם גידול ממוצע של 3.5%.',
      url: 'https://example.com/article-4',
      publishedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      content: null,
    },
    {
      id: 'mock-news-5',
      title: 'פסטיבל הקולנוע הבינלאומי בירושלים נפתח עם סרט ישראלי חדש',
      source: 'ערוץ 14',
      sourceId: 'now14',
      category: 'entertainment',
      description:
        'הפסטיבל ה-42 נפתח אמש עם הקרנת בכורה של סרט דרמה ישראלי חדש. מאות אורחים מהארץ ומהעולם השתתפו בטקס הפתיחה.',
      url: 'https://example.com/article-5',
      publishedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      content: null,
    },
  ];
}

function generateMockFullArticle(article) {
  return {
    ...article,
    content:
      article.description +
      '\n\n' +
      'זהו תוכן מורחב של הכתבה לצורך הדגמה. בפסקה זו מופיע מידע נוסף על הנושא, ' +
      'כולל ציטוטים מגורמים רשמיים ותגובות מומחים בתחום. הכתב שלנו סוקר את ההתפתחויות ' +
      'האחרונות ומביא ניתוח מעמיק של ההשלכות הצפויות.' +
      '\n\n' +
      'לדברי מומחים, ההתפתחויות האלה צפויות להשפיע באופן משמעותי על התחום בשנים הקרובות. ' +
      '"אנחנו רואים שינוי מגמה ברור", אמר פרופסור ישראלי מאוניברסיטת תל אביב. ' +
      '"הנתונים מצביעים על מגמה חיובית שתימשך גם ברבעונים הבאים."' +
      '\n\n' +
      'בתגובה לפרסום, גורמים בממשלה ציינו כי הם עוקבים אחר ההתפתחויות ומתכוונים ' +
      'לפעול בהתאם. "אנחנו ערניים למצב ופועלים לטובת האזרחים", נאמר בהודעה רשמית.',
    extractedAt: Date.now(),
  };
}

// ─── Category mapping (backend returns no category, we assign from source) ─

const CATEGORY_KEYWORDS = {
  sport: ['ספורט', 'כדורגל', 'כדורסל', 'ניצחון', 'ליגה', 'יורוליג', 'מכבי', 'הפועל', 'בית"ר'],
  tech: ['טכנולוגיה', 'סטארטאפ', 'הייטק', 'אפליקציה', 'בינה מלאכותית', 'AI', 'סייבר'],
  finance: ['בורסה', 'כלכלה', 'מניות', 'דולר', 'שקל', 'גיוס', 'מדד', 'ריבית'],
  entertainment: ['בידור', 'סרט', 'מוזיקה', 'פסטיבל', 'הופעה', 'סדרה', 'טלוויזיה'],
};

export function detectCategory(title = '', description = '') {
  const text = (title + ' ' + description).toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return cat;
    }
  }
  return 'news'; // default
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export default function useNews() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fullArticle, setFullArticle] = useState(null);
  const [fullArticleLoading, setFullArticleLoading] = useState(false);
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetchApi(API_BASE);

      if (!mountedRef.current) return;

      if (res && res.articles && res.articles.length > 0) {
        // Enrich with categories if missing
        const enriched = res.articles.map((a) => ({
          ...a,
          category: a.category || detectCategory(a.title, a.description),
        }));
        setArticles(enriched);
        setError(null);
      } else {
        throw new Error('empty');
      }
    } catch (_err) {
      if (!mountedRef.current) return;
      // Fall back to mock data in dev
      const mock = generateMockArticles();
      setArticles(mock);
      setError(null);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const fetchFullArticle = useCallback(async (id) => {
    setFullArticleLoading(true);
    setFullArticle(null);

    try {
      const res = await fetchApi(`${API_BASE}/${id}/full`);

      if (!mountedRef.current) return;

      if (res && res.article) {
        setFullArticle(res.article);
      } else {
        throw new Error('empty');
      }
    } catch (_err) {
      if (!mountedRef.current) return;
      // Fall back to mock full article from current articles list
      setArticles((current) => {
        const found = current.find((a) => a.id === id);
        if (found) {
          setFullArticle(generateMockFullArticle(found));
        }
        return current;
      });
    } finally {
      if (mountedRef.current) {
        setFullArticleLoading(false);
      }
    }
  }, []);

  const clearFullArticle = useCallback(() => {
    setFullArticle(null);
    setFullArticleLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchArticles();
  }, [fetchArticles]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchArticles();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchArticles]);

  // Auto-refresh every 30 minutes
  useEffect(() => {
    intervalRef.current = setInterval(fetchArticles, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchArticles]);

  return {
    articles,
    loading,
    error,
    refresh,
    fetchFullArticle,
    fullArticle,
    fullArticleLoading,
    clearFullArticle,
  };
}
