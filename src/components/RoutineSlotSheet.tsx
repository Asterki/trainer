/** Editor for one routine slot: workout focus or rest, plus a short note. */

import { useEffect, useId, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import type { RoutineSlot, Weekday } from '../domain/types';

const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const FOCUS_SUGGESTIONS = [
  'Push',
  'Pull',
  'Legs',
  'Upper',
  'Lower',
  'Full body',
  'Cardio',
  'Mobility',
];

interface RoutineSlotSheetProps {
  open: boolean;
  slot: RoutineSlot | null;
  onClose: () => void;
  onSave: (slot: RoutineSlot) => void;
}

export function RoutineSlotSheet({ open, slot, onClose, onSave }: RoutineSlotSheetProps) {
  const formId = useId();
  const [kind, setKind] = useState<'workout' | 'rest'>('workout');
  const [focus, setFocus] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open || !slot) return;
    setKind(slot.kind);
    setFocus(slot.focus);
    setNote(slot.note);
  }, [open, slot]);

  if (!slot) return null;

  const title = `Week ${slot.weekIndex + 1} · ${WEEKDAY_NAMES[slot.weekday]}`;

  function submit() {
    if (!slot) return;
    onSave({
      weekIndex: slot.weekIndex,
      weekday: slot.weekday,
      kind,
      focus: kind === 'workout' ? focus.trim().slice(0, 40) : '',
      note: note.trim().slice(0, 200),
    });
  }

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" form={formId}>
            Save slot
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="slot-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <span className="field__label" id={`${formId}-kind`}>
            Day type
          </span>
          <div className="segmented" role="group" aria-labelledby={`${formId}-kind`}>
            <button
              type="button"
              className={`segmented__item${kind === 'workout' ? ' segmented__item--active' : ''}`}
              aria-pressed={kind === 'workout'}
              onClick={() => setKind('workout')}
            >
              Workout
            </button>
            <button
              type="button"
              className={`segmented__item${kind === 'rest' ? ' segmented__item--active' : ''}`}
              aria-pressed={kind === 'rest'}
              onClick={() => setKind('rest')}
            >
              Rest
            </button>
          </div>
        </div>

        {kind === 'workout' && (
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-focus`}>
              Focus
            </label>
            <input
              id={`${formId}-focus`}
              className="input"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              maxLength={40}
              placeholder="Push, Upper, Legs…"
              autoFocus
            />
            <span className="field__hint">
              The AI chooses exercises for this focus. Free text is allowed.
            </span>
            <div className="focus-chips" aria-label="Focus suggestions">
              {FOCUS_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`chip${focus === suggestion ? ' chip--selected' : ''}`}
                  onClick={() => setFocus(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor={`${formId}-note`}>
            Note <span className="field__optional">(optional)</span>
          </label>
          <textarea
            id={`${formId}-note`}
            className="input input--textarea slot-form__note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="Anything worth remembering about this day."
          />
          <span className="field__hint">{note.length}/200 characters</span>
        </div>
      </form>
    </BottomSheet>
  );
}
