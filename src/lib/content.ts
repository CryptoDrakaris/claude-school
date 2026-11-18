import { Marked } from 'marked';
import programData from '../../content/program.json';
import blocksData from '../../content/blocks.json';

// Содержание уроков – файлы в content/lessons/NN-slug/. Ответов на тесты здесь нет и быть не должно.
export interface LessonMeta {
  id: number;
  slug: string;
  title: string;
  about: string;
  ready: boolean;
  block: number;
}

// Блоки курса: первый урок блока открывается после теста и принятого задания последнего урока прошлого блока.
export interface BlockMeta {
  id: number;
  title: string;
  about: string;
  from: number;
  to: number;
}

export interface QuizQuestion {
  text: string;
  options: string[];
}

export interface LessonContent {
  lesson: string | null;
  practice: string | null;
  homework: string | null;
  quiz: QuizQuestion[] | null;
}

export const program = programData as LessonMeta[];
export const blocks = blocksData as BlockMeta[];

export const blockOf = (lessonId: number) => blocks.find((b) => lessonId >= b.from && lessonId <= b.to)!;
export const isBlockStart = (lessonId: number) => lessonId > 1 && blocks.some((b) => b.from === lessonId);

// Почему урок закрыт – одна фраза для зачётки и страницы урока.
export function closedReason(lessonId: number): string {
  if (isBlockStart(lessonId)) {
    const b = blockOf(lessonId);
    return `Блок ${b.id} «${b.title}» откроется, когда тест урока ${lessonId - 1} будет сдан на 6 из 8 и владелец курса примет итоговое задание урока ${lessonId - 1}.`;
  }
  return `Урок ${lessonId} откроется, когда тест урока ${lessonId - 1} будет сдан на 6 из 8.`;
}

const markdownFiles = import.meta.glob('/content/lessons/*/*.md', { query: '?raw', import: 'default' });
const quizFiles = import.meta.glob('/content/lessons/*/quiz.json', { import: 'default' });

async function load<T>(files: Record<string, () => Promise<unknown>>, path: string): Promise<T | null> {
  const loader = files[path];
  return loader ? ((await loader()) as T) : null;
}

export async function loadLesson(meta: LessonMeta): Promise<LessonContent> {
  const base = `/content/lessons/${meta.slug}`;
  const [lesson, practice, homework, quiz] = await Promise.all([
    load<string>(markdownFiles, `${base}/lesson.md`),
    load<string>(markdownFiles, `${base}/practice.md`),
    load<string>(markdownFiles, `${base}/homework.md`),
    load<{ questions: QuizQuestion[] }>(quizFiles, `${base}/quiz.json`),
  ]);
  return { lesson, practice, homework, quiz: quiz?.questions ?? null };
}

const marked = new Marked({
  gfm: true,
  renderer: {
    // Внешние ссылки – в новой вкладке, чтобы не терять место в уроке.
    link({ href, text }) {
      const external = /^https?:\/\//.test(href);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${attrs}>${text}</a>`;
    },
  },
});

// Первый заголовок файла (# …) страница показывает сама, поэтому он убирается.
// Остальные сдвигаются на уровень вниз: на странице раздел урока – h2, его подзаголовки – h3.
export function renderMarkdown(source: string, { dropTitle = true } = {}): string {
  const text = (dropTitle ? source.replace(/^#\s+.*\n+/, '') : source).replace(/^(#{2,5})\s/gm, '#$1 ');
  return marked.parse(text, { async: false }) as string;
}
