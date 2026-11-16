import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Строка my_progress(): один урок участника (см. миграцию, функция _progress).
export interface ProgressRow {
  lesson_id: number;
  is_open: boolean;
  opened_at: string | null;
  best_score: number | null;
  max_score: number | null;
  attempts: number;
  passed: boolean;
  two_failed: boolean;
  hw_status: 'submitted' | 'accepted' | 'needs_rework' | null;
  hw_score: number | null;
  hw_submitted_at: string | null;
  last_activity: string | null;
  lagging: boolean;
}

export type LessonStatus = 'closed' | 'open' | 'test-passed' | 'hw-submitted' | 'hw-rework' | 'hw-accepted';

export function lessonStatus(row: ProgressRow | undefined): LessonStatus {
  if (!row || !row.is_open) return 'closed';
  if (row.hw_status === 'accepted') return 'hw-accepted';
  if (row.hw_status === 'needs_rework') return 'hw-rework';
  if (row.hw_status === 'submitted') return 'hw-submitted';
  if (row.passed) return 'test-passed';
  return 'open';
}

export const STATUS_TEXT: Record<LessonStatus, string> = {
  closed: 'закрыт',
  open: 'открыт',
  'test-passed': 'тест сдан',
  'hw-submitted': 'на проверке',
  'hw-rework': 'на доработку',
  'hw-accepted': 'принято',
};

export function useProgress() {
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase.rpc('my_progress');
    if (err) {
      setError('Прогресс не загрузился. Обновите страницу.');
      return;
    }
    setRows(data as ProgressRow[]);
    setError(null);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, error, reload };
}
