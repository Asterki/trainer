/** Routine — define the repeating weeks that drive future sessions. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiArrowLeft,
  FiCalendar,
  FiCheck,
  FiCopy,
  FiEdit2,
  FiPlus,
  FiRepeat,
  FiTrash2,
} from 'react-icons/fi';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RoutineGrid } from '../components/RoutineGrid';
import { RoutinePreview } from '../components/RoutinePreview';
import { RoutineSlotSheet } from '../components/RoutineSlotSheet';
import { isValidIsoDate, todayIso } from '../domain/date';
import type { Routine, RoutineSlot, Weekday } from '../domain/types';
import { useActiveRoutine, useMediaQuery } from '../state/hooks';
import { useTrainer } from '../state/store';

const startDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

interface RoutineDraft {
  id: string | null;
  name: string;
  notes: string;
  startDate: string;
  weekCount: number;
  slots: RoutineSlot[];
  active: boolean;
}

type ConfirmState =
  | { type: 'delete'; routine: Routine }
  | { type: 'activate'; id: string; name: string; startDate: string }
  | { type: 'clear-week'; weekIndex: number }
  | { type: 'remove-week' }
  | { type: 'discard' }
  | { type: 'close' };

function cloneSlots(slots: RoutineSlot[]): RoutineSlot[] {
  return slots.map((slot) => ({ ...slot }));
}

function gridSlots(weekCount: number, source: RoutineSlot[] = []): RoutineSlot[] {
  const slots: RoutineSlot[] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    for (let day = 1; day <= 7; day += 1) {
      const weekday = day as Weekday;
      const existing = source.find(
        (slot) => slot.weekIndex === weekIndex && slot.weekday === weekday,
      );
      slots.push(
        existing
          ? { ...existing }
          : { weekIndex, weekday, kind: 'rest', focus: '', note: '' },
      );
    }
  }
  return slots;
}

function draftFromRoutine(routine: Routine): RoutineDraft {
  return {
    id: routine.id,
    name: routine.name,
    notes: routine.notes,
    startDate: routine.startDate,
    weekCount: routine.weekCount,
    slots: cloneSlots(routine.slots),
    active: routine.active,
  };
}

function blankDraft(): RoutineDraft {
  return {
    id: null,
    name: '',
    notes: '',
    startDate: todayIso(),
    weekCount: 1,
    slots: gridSlots(1),
    active: false,
  };
}

function draftToRoutine(draft: RoutineDraft): Routine {
  const now = new Date().toISOString();
  return {
    id: draft.id ?? 'preview',
    name: draft.name,
    notes: draft.notes,
    startDate: draft.startDate,
    weekCount: draft.weekCount,
    slots: draft.slots,
    active: draft.active,
    createdAt: now,
    updatedAt: now,
  };
}

function sameDraft(a: RoutineDraft, b: RoutineDraft): boolean {
  return (
    a.name === b.name &&
    a.notes === b.notes &&
    a.startDate === b.startDate &&
    a.weekCount === b.weekCount &&
    a.slots.length === b.slots.length &&
    a.slots.every((slot, index) => {
      const other = b.slots[index];
      return (
        slot.weekIndex === other.weekIndex &&
        slot.weekday === other.weekday &&
        slot.kind === other.kind &&
        slot.focus === other.focus &&
        slot.note === other.note
      );
    })
  );
}

function cleanedSlots(slots: RoutineSlot[]): RoutineSlot[] {
  return slots.map((slot) =>
    slot.kind === 'workout'
      ? { ...slot, focus: slot.focus.trim().slice(0, 40) || 'Workout', note: slot.note.trim() }
      : { ...slot, focus: '', note: slot.note.trim() },
  );
}

function focusInitials(focus: string): string {
  const words = focus
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'W';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function RoutineView({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { routines, createRoutine, updateRoutine, deleteRoutine, setActiveRoutine } =
    useTrainer();
  const isMobile = useMediaQuery('(max-width: 860px)');
  const activeRoutine = useActiveRoutine();
  const [editor, setEditor] = useState<{
    draft: RoutineDraft;
    baseline: RoutineDraft;
    isNew: boolean;
  } | null>(null);
  const [editingSlot, setEditingSlot] = useState<RoutineSlot | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const slotTrigger = useRef<HTMLButtonElement | null>(null);

  const dirty = editor ? editor.isNew || !sameDraft(editor.draft, editor.baseline) : false;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(false);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sortedRoutines = useMemo(
    () =>
      [...routines].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      }),
    [routines],
  );

  const openEditor = useCallback((routine: Routine) => {
    const draft = draftFromRoutine(routine);
    setEditor({ draft, baseline: draftFromRoutine(routine), isNew: false });
    setError(null);
  }, []);

  const openNew = useCallback(() => {
    const draft = blankDraft();
    setEditor({ draft, baseline: blankDraft(), isNew: true });
    setError(null);
  }, []);

  function setDraft(next: RoutineDraft) {
    setEditor((current) => (current ? { ...current, draft: next } : current));
  }

  function requestClose() {
    if (!editor) return;
    if (dirty) setConfirmState({ type: 'close' });
    else setEditor(null);
  }

  function requestDiscard() {
    if (!editor) return;
    if (dirty) setConfirmState({ type: 'discard' });
    else discardNow();
  }

  function discardNow() {
    if (!editor) return;
    if (editor.isNew) {
      setEditor(null);
    } else {
      const active = editor.draft.active;
      const baseline = { ...editor.baseline, active };
      setEditor({
        draft: { ...baseline, slots: cloneSlots(baseline.slots) },
        baseline: { ...baseline, slots: cloneSlots(baseline.slots) },
        isNew: false,
      });
    }
    setError(null);
  }

  function validate(): string | null {
    if (!editor) return 'No routine is open.';
    const name = editor.draft.name.trim();
    if (name.length < 2 || name.length > 60) return 'Give the routine a name of 2–60 characters.';
    if (!isValidIsoDate(editor.draft.startDate)) return 'Choose a valid start date.';
    if (!editor.draft.slots.some((slot) => slot.kind === 'workout')) {
      return 'Add at least one workout day.';
    }
    return null;
  }

  async function save(activateAfter: boolean) {
    if (!editor) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setSaving(true);
    const slots = cleanedSlots(editor.draft.slots);
    try {
      let savedDraft: RoutineDraft;
      if (editor.draft.id) {
        await updateRoutine(editor.draft.id, {
          name: editor.draft.name.trim(),
          notes: editor.draft.notes,
          startDate: editor.draft.startDate,
          weekCount: editor.draft.weekCount,
          slots,
        });
        savedDraft = {
          ...editor.draft,
          name: editor.draft.name.trim(),
          notes: editor.draft.notes.trim(),
          slots,
        };
        setEditor({ draft: savedDraft, baseline: { ...savedDraft }, isNew: false });
        setToast(`Saved “${savedDraft.name}”.`);
      } else {
        const created = await createRoutine({
          name: editor.draft.name.trim(),
          notes: editor.draft.notes,
          startDate: editor.draft.startDate,
          weekCount: editor.draft.weekCount,
          slots,
        });
        savedDraft = draftFromRoutine(created);
        setEditor({
          draft: savedDraft,
          baseline: draftFromRoutine(created),
          isNew: false,
        });
        setToast(`Created “${created.name}”.`);
      }

      if (activateAfter) {
        setConfirmState({
          type: 'activate',
          id: savedDraft.id ?? '',
          name: savedDraft.name,
          startDate: savedDraft.startDate,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the routine.');
    } finally {
      setSaving(false);
    }
  }

  function changeWeekCount(nextCount: number) {
    if (!editor || nextCount < 1 || nextCount > 12) return;
    const next: RoutineDraft = {
      ...editor.draft,
      weekCount: nextCount,
      slots: gridSlots(nextCount, editor.draft.slots),
    };
    setDraft(next);
  }

  function requestRemoveWeek() {
    if (!editor || editor.draft.weekCount <= 1) return;
    const lastWeek = editor.draft.weekCount - 1;
    const hasWorkout = editor.draft.slots.some(
      (slot) => slot.weekIndex === lastWeek && slot.kind === 'workout',
    );
    if (hasWorkout) {
      setConfirmState({ type: 'remove-week' });
    } else {
      changeWeekCount(editor.draft.weekCount - 1);
    }
  }

  function copyPreviousWeek(weekIndex: number) {
    if (!editor || weekIndex <= 0) return;
    const slots = editor.draft.slots.map((slot) => {
      if (slot.weekIndex !== weekIndex) return slot;
      const previous = editor.draft.slots.find(
        (candidate) =>
          candidate.weekIndex === weekIndex - 1 && candidate.weekday === slot.weekday,
      );
      return previous
        ? {
            weekIndex: slot.weekIndex,
            weekday: slot.weekday,
            kind: previous.kind,
            focus: previous.focus,
            note: previous.note,
          }
        : slot;
    });
    setDraft({ ...editor.draft, slots });
    setToast(`Copied week ${weekIndex} into week ${weekIndex + 1}.`);
  }

  function requestClearWeek(weekIndex: number) {
    setConfirmState({ type: 'clear-week', weekIndex });
  }

  function openSlot(slot: RoutineSlot, trigger: HTMLButtonElement) {
    slotTrigger.current = trigger;
    setEditingSlot(slot);
  }

  function closeSlotSheet() {
    setEditingSlot(null);
    window.requestAnimationFrame(() => slotTrigger.current?.focus());
  }

  function saveSlot(slot: RoutineSlot) {
    if (!editor) return;
    setDraft({
      ...editor.draft,
      slots: editor.draft.slots.map((candidate) =>
        candidate.weekIndex === slot.weekIndex && candidate.weekday === slot.weekday
          ? slot
          : candidate,
      ),
    });
    closeSlotSheet();
  }

  function requestActivate(routine: { id: string; name: string; startDate: string }) {
    setConfirmState({ type: 'activate', ...routine });
  }

  async function activate(id: string, name: string) {
    try {
      await setActiveRoutine(id);
      setEditor((current) => {
        if (!current || current.draft.id !== id) return current;
        return {
          ...current,
          draft: { ...current.draft, active: true },
          baseline: { ...current.baseline, active: true },
        };
      });
      setToast(`“${name}” is now active.`);
      setConfirmState(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not activate the routine.');
      setConfirmState(null);
    }
  }

  async function removeRoutine(routine: Routine) {
    try {
      await deleteRoutine(routine.id);
      if (editor?.draft.id === routine.id) setEditor(null);
      setToast(`Deleted “${routine.name}”.`);
      setConfirmState(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the routine.');
      setConfirmState(null);
    }
  }

  async function duplicateRoutine(routine: Routine) {
    try {
      const copy = await createRoutine({
        name: `${routine.name} copy`,
        notes: routine.notes,
        startDate: routine.startDate < todayIso() ? todayIso() : routine.startDate,
        weekCount: routine.weekCount,
        slots: cloneSlots(routine.slots),
      });
      setToast(`Duplicated as “${copy.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not duplicate the routine.');
    }
  }

  function confirmBody() {
    if (!confirmState) return null;
    if (confirmState.type === 'delete') {
      return (
        <p>
          Delete “{confirmState.routine.name}”? It will stop scheduling new sessions. Existing
          sessions and history keep their snapshots.
        </p>
      );
    }
    if (confirmState.type === 'activate') {
      if (activeRoutine && activeRoutine.id !== confirmState.id) {
        return (
          <p>
            “{activeRoutine.name}” will stop scheduling new sessions. “{confirmState.name}” starts
            scheduling from {startDateFormat.format(new Date(`${confirmState.startDate}T12:00:00`))}.
            Existing sessions and history are kept.
          </p>
        );
      }
      return (
        <p>
          Use “{confirmState.name}” from{' '}
          {startDateFormat.format(new Date(`${confirmState.startDate}T12:00:00`))}? Existing sessions
          are unchanged.
        </p>
      );
    }
    if (confirmState.type === 'clear-week') {
      return (
        <p>
          Clear week {confirmState.weekIndex + 1}? All seven days become rest. This changes the draft;
          nothing is saved until you save the routine.
        </p>
      );
    }
    if (confirmState.type === 'remove-week') {
      return (
        <p>
          Remove the last week? Its workouts stop being scheduled. This changes the draft; nothing is
          saved until you save the routine.
        </p>
      );
    }
    if (confirmState.type === 'discard') {
      return <p>Discard changes and return to the last saved version of this routine?</p>;
    }
    return <p>Close the editor and discard your unsaved changes?</p>;
  }

  function confirmLabels() {
    if (!confirmState) return { title: '', confirmLabel: 'Confirm', tone: 'default' as const };
    if (confirmState.type === 'delete') {
      return { title: 'Delete routine?', confirmLabel: 'Delete routine', tone: 'danger' as const };
    }
    if (confirmState.type === 'activate') {
      const switching = activeRoutine !== null && activeRoutine.id !== confirmState.id;
      return {
        title: switching ? 'Switch active routine?' : 'Set active routine?',
        confirmLabel: switching ? 'Switch routine' : 'Set active',
        tone: 'default' as const,
      };
    }
    if (confirmState.type === 'clear-week') {
      return { title: 'Clear week?', confirmLabel: 'Clear week', tone: 'danger' as const };
    }
    if (confirmState.type === 'remove-week') {
      return { title: 'Remove last week?', confirmLabel: 'Remove week', tone: 'danger' as const };
    }
    if (confirmState.type === 'discard') {
      return { title: 'Discard changes?', confirmLabel: 'Discard changes', tone: 'danger' as const };
    }
    return { title: 'Discard changes?', confirmLabel: 'Discard and close', tone: 'danger' as const };
  }

  async function handleConfirm() {
    if (!confirmState) return;
    if (confirmState.type === 'delete') {
      await removeRoutine(confirmState.routine);
      return;
    }
    if (confirmState.type === 'activate') {
      await activate(confirmState.id, confirmState.name);
      return;
    }
    if (confirmState.type === 'clear-week') {
      if (editor) {
        setDraft({
          ...editor.draft,
          slots: editor.draft.slots.map((slot) =>
            slot.weekIndex === confirmState.weekIndex
              ? { ...slot, kind: 'rest', focus: '' }
              : slot,
          ),
        });
      }
      setConfirmState(null);
      return;
    }
    if (confirmState.type === 'remove-week') {
      if (editor) changeWeekCount(editor.draft.weekCount - 1);
      setConfirmState(null);
      return;
    }
    if (confirmState.type === 'discard') {
      discardNow();
      setConfirmState(null);
      return;
    }
    setConfirmState(null);
    setEditor(null);
  }

  const confirmCopy = confirmLabels();
  const noActive = activeRoutine === null;
  const editorActive = editor?.draft.active ?? false;
  const canSave =
    editor !== null &&
    editor.draft.name.trim().length >= 2 &&
    editor.draft.name.trim().length <= 60 &&
    isValidIsoDate(editor.draft.startDate);
  const saveLabel = editor
    ? editor.isNew
      ? noActive
        ? 'Create & set active'
        : 'Create routine'
      : noActive && !editorActive
        ? 'Save & set active'
        : 'Save changes'
    : 'Save';

  function editorFooter() {
    return (
      <div className="routine-editor__actions">
        <button type="button" className="button" onClick={requestDiscard} disabled={saving}>
          Discard
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!canSave || saving}
          onClick={() => void save(noActive && !editorActive)}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    );
  }

  function editorContent() {
    if (!editor) return null;
    const draft = editor.draft;
    return (
      <div className="routine-editor">
        {!isMobile && (
          <button type="button" className="routine-editor__back" onClick={requestClose}>
            <FiArrowLeft aria-hidden="true" /> All routines
          </button>
        )}

        <header className="routine-editor__head">
          <div>
            <span className="view__eyebrow">Routine</span>
            <h1 className="view__title">
              {draft.name.trim() || (editor.isNew ? 'New routine' : 'Untitled routine')}
            </h1>
            <p className="view__subtitle">
              A repeating cycle of weeks. Each weekday is a workout focus or rest; exercises are
              chosen per session.
            </p>
          </div>
          <div className="routine-editor__status">
            {dirty && <span className="badge badge--warning">Unsaved changes</span>}
            {editorActive ? (
              <span className="badge badge--active">
                <FiCheck aria-hidden="true" /> Active
              </span>
            ) : (
              draft.id && (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const persisted = routines.find((routine) => routine.id === draft.id);
                    if (persisted) {
                      requestActivate({
                        id: persisted.id,
                        name: persisted.name,
                        startDate: persisted.startDate,
                      });
                    }
                  }}
                >
                  Set as active routine
                </button>
              )
            )}
          </div>
        </header>

        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}

        <section className="card routine-editor__meta" aria-label="Routine details">
          <div className="routine-editor__fields">
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="input"
                aria-label="Name"
                value={draft.name}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  if (error) setError(null);
                }}
                maxLength={60}
                placeholder="PPL 2-week"
                autoFocus={!isMobile}
              />
              <span className="field__hint">2–60 characters.</span>
            </label>

            <label className="field">
              <span className="field__label">Start date</span>
              <input
                className="input"
                type="date"
                aria-label="Start date"
                value={draft.startDate}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                required
              />
              <span className="field__hint">Week 1 is the Monday-based week of this date.</span>
            </label>

            <div className="field">
              <span className="field__label">Cycle length</span>
              <div className="week-stepper">
                <button
                  type="button"
                  className="icon-button"
                  onClick={requestRemoveWeek}
                  disabled={draft.weekCount <= 1}
                  aria-label="Remove last week"
                  title="Remove last week"
                >
                  −
                </button>
                <span className="week-stepper__value">
                  {draft.weekCount} {draft.weekCount === 1 ? 'week' : 'weeks'}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => changeWeekCount(draft.weekCount + 1)}
                  disabled={draft.weekCount >= 12}
                  aria-label="Add week"
                  title="Add week"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <label className="field">
            <span className="field__label">
              Notes <span className="field__optional">(optional)</span>
            </span>
            <textarea
              className="input routine-editor__notes"
              aria-label="Notes"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              maxLength={2000}
              placeholder="Why this split, progression notes, or constraints."
            />
          </label>
        </section>

        <section className="card routine-editor__grid-card" aria-label="Weekly schedule">
          <div className="routine-editor__section-head">
            <div>
              <h2 className="card__title">Weekly schedule</h2>
              <p className="card__hint">
                Select a day to set a focus or rest. Use the week menu to copy or clear a week.
              </p>
            </div>
          </div>
          <RoutineGrid
            routine={draftToRoutine(draft)}
            onEditSlot={openSlot}
            onCopyPreviousWeek={copyPreviousWeek}
            onClearWeek={requestClearWeek}
          />
        </section>

        <RoutinePreview routine={draftToRoutine(draft)} />

        {!isMobile && editorFooter()}
      </div>
    );
  }

  return (
    <div className="view routine-view">
      {toast && (
        <div className="toast-layer">
          <div className="toast" role="status">
            {toast}
          </div>
        </div>
      )}

      {!editor && (
        <>
          <header className="view__header view__header--hero">
            <div>
              <span className="view__eyebrow">Routine</span>
              <h1 className="view__title">Your training cycle</h1>
              <p className="view__subtitle">
                A routine is a repeating cycle of weeks. Each weekday is a workout focus or rest; the
                AI chooses exercises for each session.
              </p>
            </div>
            {routines.length > 0 && (
              <button type="button" className="button button--primary" onClick={openNew}>
                <FiPlus aria-hidden="true" /> New routine
              </button>
            )}
          </header>

          {routines.length === 0 ? (
            <section className="card routine-empty">
              <div className="empty-state">
                <span className="empty-state__icon">
                  <FiRepeat aria-hidden="true" />
                </span>
                <h2 className="empty-state__title">Build a routine</h2>
                <p className="empty-state__body">
                  A routine is a repeating cycle of weeks, where each weekday is a workout focus or
                  rest. The AI chooses the exercises for each session, and you log the work.
                </p>
                <button type="button" className="button button--primary" onClick={openNew}>
                  <FiPlus aria-hidden="true" /> Create routine
                </button>
              </div>
            </section>
          ) : (
            <div className="routine-list">
              {sortedRoutines.map((routine) => {
                const weekZero = Array.from({ length: 7 }, (_, index) => {
                  const weekday = (index + 1) as Weekday;
                  return (
                    routine.slots.find(
                      (slot) => slot.weekIndex === 0 && slot.weekday === weekday,
                    ) ?? { weekIndex: 0, weekday, kind: 'rest' as const, focus: '', note: '' }
                  );
                });
                return (
                  <article
                    className={`routine-card${routine.active ? ' routine-card--active' : ''}`}
                    key={routine.id}
                  >
                    <div className="routine-card__top">
                      <div className="routine-card__title-row">
                        <h2 className="routine-card__name">
                          <button
                            type="button"
                            className="routine-card__open"
                            onClick={() => openEditor(routine)}
                          >
                            {routine.name}
                          </button>
                        </h2>
                        {routine.active && <span className="badge badge--active">Active</span>}
                      </div>
                      <p className="routine-card__meta">
                        <FiCalendar aria-hidden="true" /> Starts{' '}
                        {startDateFormat.format(
                          new Date(`${routine.startDate}T12:00:00`),
                        )}{' '}
                        · {routine.weekCount} {routine.weekCount === 1 ? 'week' : 'weeks'}
                      </p>
                    </div>

                    <div className="routine-card__preview" aria-hidden="true">
                      {weekZero.map((slot) => (
                        <span
                          key={slot.weekday}
                          className={`routine-card__day routine-card__day--${slot.kind}`}
                        >
                          {slot.kind === 'workout'
                            ? focusInitials(slot.focus)
                            : <span className="routine-card__rest-dot" />}
                        </span>
                      ))}
                    </div>

                    <div className="routine-card__actions">
                      <button type="button" className="button" onClick={() => openEditor(routine)}>
                        <FiEdit2 aria-hidden="true" /> Edit
                      </button>
                      {!routine.active && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => requestActivate(routine)}
                        >
                          <FiCheck aria-hidden="true" /> Set active
                        </button>
                      )}
                      <button
                        type="button"
                        className="button"
                        onClick={() => void duplicateRoutine(routine)}
                      >
                        <FiCopy aria-hidden="true" /> Duplicate
                      </button>
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() => setConfirmState({ type: 'delete', routine })}
                      >
                        <FiTrash2 aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {editor &&
        (isMobile ? (
          <BottomSheet
            open
            className="sheet--full"
            title={editor.isNew ? 'New routine' : editor.draft.name || 'Edit routine'}
            onClose={requestClose}
            footer={editorFooter()}
          >
            {editorContent()}
          </BottomSheet>
        ) : (
          editorContent()
        ))}

      <RoutineSlotSheet
        open={editingSlot !== null}
        slot={editingSlot}
        onClose={closeSlotSheet}
        onSave={saveSlot}
      />

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmCopy.title}
        confirmLabel={confirmCopy.confirmLabel}
        tone={confirmCopy.tone}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => void handleConfirm()}
      >
        {confirmBody()}
      </ConfirmDialog>
    </div>
  );
}
