/** Routine — define the repeating weeks that drive future sessions. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiArrowLeft,
  FiCalendar,
  FiCheck,
  FiCopy,
  FiPlus,
  FiRepeat,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RoutineGrid } from '../components/RoutineGrid';
import { RoutinePreview } from '../components/RoutinePreview';
import { RoutineSlotSheet } from '../components/RoutineSlotSheet';
import { isValidIsoDate, todayIso } from '../domain/date';
import type { Routine, RoutineSlot, Weekday } from '../domain/types';
import { useMediaQuery } from '../state/hooks';
import { useTrainer } from '../state/store';

const startDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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
  | { type: 'clear-week'; weekIndex: number }
  | { type: 'remove-week' };

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
    active: true,
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

export function RoutineView() {
  const { routines, createRoutine, updateRoutine, deleteRoutine, setActiveRoutine, setRoutineActive } =
    useTrainer();
  const isMobile = useMediaQuery('(max-width: 860px)');
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

  async function toggleActive() {
    if (!editor) return;
    const active = !editor.draft.active;
    setDraft({ ...editor.draft, active });
    if (editor.isNew || !editor.draft.id) return;
    await setRoutineActive(editor.draft.id, active);
    setEditor((current) =>
      current ? { ...current, baseline: { ...current.baseline, active } } : current,
    );
  }

  function requestClose() {
    setEditor(null);
  }

  function requestDiscard() {
    discardNow();
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

  async function save() {
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
        setToast(`Saved “${savedDraft.name}”.`);
      } else {
        const created = await createRoutine({
          name: editor.draft.name.trim(),
          notes: editor.draft.notes,
          startDate: editor.draft.startDate,
          weekCount: editor.draft.weekCount,
          slots,
        });
        savedDraft = { ...draftFromRoutine(created), active: editor.draft.active };
        if (savedDraft.active) await setRoutineActive(created.id, true);
        setToast(`Created “${created.name}”.`);
      }

      setEditor({ draft: savedDraft, baseline: { ...savedDraft }, isNew: false });
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

  async function toggleRoutine(routine: { id: string; name: string; active: boolean }) {
    try {
      if (routine.active) {
        await setRoutineActive(routine.id, false);
      } else {
        await setActiveRoutine(routine.id);
      }
      setEditor((current) => {
        if (!current || current.draft.id !== routine.id) return current;
        return {
          ...current,
          draft: { ...current.draft, active: !routine.active },
          baseline: { ...current.baseline, active: !routine.active },
        };
      });
      setToast(`“${routine.name}” is now ${routine.active ? 'inactive' : 'active'}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the routine state.');
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
    return null;
  }

  function confirmLabels() {
    if (!confirmState) return { title: '', confirmLabel: 'Confirm', tone: 'default' as const };
    if (confirmState.type === 'delete') {
      return { title: 'Delete routine?', confirmLabel: 'Delete routine', tone: 'danger' as const };
    }
    if (confirmState.type === 'clear-week') {
      return { title: 'Clear week?', confirmLabel: 'Clear week', tone: 'danger' as const };
    }
    if (confirmState.type === 'remove-week') {
      return { title: 'Remove last week?', confirmLabel: 'Remove week', tone: 'danger' as const };
    }
    return { title: '', confirmLabel: 'Confirm', tone: 'default' as const };
  }

  async function handleConfirm() {
    if (!confirmState) return;
    if (confirmState.type === 'delete') {
      await removeRoutine(confirmState.routine);
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
    }
  }

  const confirmCopy = confirmLabels();
  const canSave =
    editor !== null &&
    editor.draft.name.trim().length >= 2 &&
    editor.draft.name.trim().length <= 60 &&
    isValidIsoDate(editor.draft.startDate);
  const saveLabel = editor?.isNew ? 'Create routine' : 'Save changes';

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
          onClick={() => void save()}
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
          <div className="routine-editor__title">
            <span className="view__eyebrow">Routine</span>
            <h1 className="view__title">
              {draft.name.trim() || (editor.isNew ? 'New routine' : 'Untitled routine')}
            </h1>
          </div>
          <div className="routine-editor__status">
            <div className="toggle-row routine-editor__active">
              <div className="toggle-row__copy">
                <span className="toggle-row__label">Active routine</span>
              </div>
              <button
                type="button"
                role="switch"
                className={`switch${draft.active ? ' switch--on' : ''}`}
                aria-checked={draft.active}
                aria-label="Active routine"
                onClick={() => void toggleActive()}
              >
                <span className="switch__thumb" aria-hidden="true" />
              </button>
            </div>
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
                Plan each workout, then log the sets as you train.
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
                  A repeating cycle of weeks. Mark each weekday as a workout focus or rest.
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
                        · {routine.weekCount}-week cycle
                      </p>
                    </div>

                    <div className="routine-card__preview" aria-hidden="true">
                      {weekZero.map((slot) => (
                        <span
                          key={slot.weekday}
                          className={`routine-card__day routine-card__day--${slot.kind}`}
                        >
                          {slot.kind === 'workout' ? (
                            <span className="routine-card__day-initials">
                              {focusInitials(slot.focus)}
                            </span>
                          ) : (
                            <span className="routine-card__rest-dot" />
                          )}
                          <span className="routine-card__day-label">
                            {WEEKDAY_LABELS[slot.weekday - 1]}
                          </span>
                        </span>
                      ))}
                    </div>

                    <div className="routine-card__actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => void toggleRoutine(routine)}
                      >
                        {routine.active ? (
                          <FiX aria-hidden="true" />
                        ) : (
                          <FiCheck aria-hidden="true" />
                        )}{' '}
                        {routine.active ? 'Deactivate' : 'Set active'}
                      </button>
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
