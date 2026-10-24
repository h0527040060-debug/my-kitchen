import type { Recipe } from './domain.ts'

// Examples are displayed only while signed out. Never inserted into Supabase.
const common = { owner_id: 'demo', created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z' }
export const demoRecipes: Recipe[] = [
  { ...common, id: 'demo-1', title: 'פסטה עגבניות ובזיליקום', description: 'כמה מצרכים טובים, סיר אחד, וארוחת ערב שמרגישה כמו חופשה באיטליה.', category: 'עיקריות', prep_minutes: 10, cook_minutes: 20, servings: 4, favorite: true,
    image_url: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=85',
    ingredients: ['400 גרם פסטה', '500 גרם עגבניות שרי חצויות', '3 שיני שום פרוסות', '3 כפות שמן זית', 'חופן עלי בזיליקום', 'מלח ופלפל לפי הטעם'],
    instructions: ['מבשלים את הפסטה לפי ההוראות שעל האריזה ושומרים כוס ממי הבישול.', 'מחממים שמן זית במחבת, מוסיפים שום ועגבניות ומבשלים 15 דקות.', 'מערבבים את הפסטה עם הרוטב ומעט ממי הבישול. מתבלים ומסיימים בבזיליקום.'] },
  { ...common, id: 'demo-2', title: 'סלט של שוק', description: 'ירקות פריכים, עשבי תיבול ולימון. כל הטוב של השוק בקערה אחת.', category: 'סלטים', prep_minutes: 15, cook_minutes: 0, servings: 2, favorite: false,
    image_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85',
    ingredients: ['2 מלפפונים', '2 עגבניות', '1 פלפל אדום', 'חופן פטרוזיליה קצוצה', '2 כפות שמן זית', 'מיץ מחצי לימון', 'מלח לפי הטעם'],
    instructions: ['חותכים את הירקות לקוביות ומעבירים לקערה.', 'מוסיפים פטרוזיליה, שמן זית ולימון.', 'מתבלים במלח, מערבבים ומגישים מיד.'] },
  { ...common, id: 'demo-3', title: 'פנקייקים של שבת בבוקר', description: 'אווריריים, זהובים ובדיוק מתוקים מספיק. סיבה טובה לצאת מהמיטה.', category: 'ארוחות בוקר', prep_minutes: 10, cook_minutes: 15, servings: 4, favorite: true,
    image_url: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=900&q=85',
    ingredients: ['1 כוס קמח', '1 כוס חלב', '1 ביצה', '2 כפות סוכר', '1 כפית אבקת אפייה', '2 כפות חמאה מומסת', 'מעט חמאה לשימון המחבת'],
    instructions: ['מערבבים בקערה קמח, סוכר ואבקת אפייה.', 'טורפים בקערה נפרדת חלב, ביצה וחמאה. מאחדים בעדינות עם היבשים.', 'מחממים ומשמנים מחבת על אש בינונית. יוצקים עיגולים קטנים ומטגנים עד שמופיעות בועות.', 'הופכים, מטגנים כדקה נוספת ומגישים עם התוספות שאוהבים.'] },
]
