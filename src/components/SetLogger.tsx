import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { FiCheck, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { SessionExercise, SetLog, Settings, WeightUnit } from '../domain/types';
import {
  displayMaxWeight,
  formatWeightInput,
  weightToKg,
} from '../domain/units';
import { useTrainer } from '../state/store';

let audioContext: AudioContext | null = null;

function playFeedback(settings: Settings) {
  if (settings.hapticsEnabled && 'vibrate' in navigator) {
    navigator.vibrate(12);
  }
  if (!settings.soundEnabled) return;

  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 660;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch {
    /* Audio is best effort. */
  }
}

interface SetRowProps {
  set: SetLog;
  index: number;
  unit: WeightUnit;
  draft?: boolean;
  disabled: boolean;
  onPersist: (value: { weight: number; reps: number }) => Promise<void>;
  onRemove: () => void;
  onEnter: () => void;
  onSavingChange: (delta: number) => void;
}

function SetRow({
  set,
  index,
  unit,
  draft = false,
  disabled,
  onPersist,
  onRemove,
  onEnter,
  onSavingChange,
}: SetRowProps) {
  const [weight, setWeight] = useState(formatWeightInput(set.weight, unit));
  const [reps, setReps] = useState(String(set.reps));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const weightRef = useRef(weight);
  const repsRef = useRef(reps);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (draft) return;
    const nextWeight = formatWeightInput(set.weight, unit);
    setWeight(nextWeight);
    setReps(String(set.reps));
    weightRef.current = nextWeight;
    repsRef.current = String(set.reps);
  }, [draft, set.reps, set.weight, unit]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function persist() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const nextReps = Number(repsRef.current);
    if (!Number.isInteger(nextReps) || nextReps < 1 || nextReps > 999) {
      setError('Reps must be a whole number from 1 to 999.');
      return false;
    }
    const parsedWeight = weightRef.current.trim() === '' ? 0 : Number(weightRef.current);
    if (!Number.isFinite(parsedWeight) || parsedWeight < 0 || parsedWeight > displayMaxWeight(unit)) {
      setError(`Weight must be between 0 and ${displayMaxWeight(unit).toLocaleString()} ${unit}.`);
      return false;
    }
    const nextWeight = Math.round(weightToKg(parsedWeight, unit) * 100) / 100;
    setError(null);

    if (!draft && nextWeight === set.weight && nextReps === set.reps) return true;

    setSaving(true);
    onSavingChange(1);
    try {
      await onPersist({ weight: nextWeight, reps: nextReps });
      return true;
    } catch {
      setError('Could not save. Retry.');
      return false;
    } finally {
      setSaving(false);
      onSavingChange(-1);
    }
  }

  function schedule() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void persist();
    }, 300);
  }

  function changeWeight(value: string) {
    setWeight(value);
    weightRef.current = value;
    setError(null);
    schedule();
  }

  function changeReps(value: string) {
    setReps(value);
    repsRef.current = value;
    setError(null);
    schedule();
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const currentRow = event.currentTarget.closest('[data-set-row]');
    const nextRow =
      event.relatedTarget instanceof Element
        ? event.relatedTarget.closest('[data-set-row]')
        : null;
    // Moving from weight to reps in the same set should not save a half-edited row.
    if (currentRow && nextRow === currentRow) return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.set-row__remove')) {
      return;
    }
    void persist();
  }

  return (
    <div className={`set-row${draft ? ' set-row--draft' : ''}`} data-set-row data-draft={draft || undefined}>
      <span className="set-row__index" aria-hidden="true">
        {index}
      </span>
      <label className="set-row__field">
        <span className="visually-hidden">Weight in {unit === 'kg' ? 'kilograms' : 'pounds'}</span>
        <input
          className="input input--num set-row__input"
          type="number"
          inputMode="decimal"
          min={0}
          max={displayMaxWeight(unit)}
          step={unit === 'lb' ? 1 : 0.5}
          value={weight}
          disabled={disabled}
          data-field="weight"
          aria-label={`Set ${index} weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
          onChange={(event) => changeWeight(event.target.value)}
          onBlur={handleBlur}
        />
        <span className="set-row__suffix">{unit}</span>
      </label>
      <label className="set-row__field">
        <span className="visually-hidden">Repetitions</span>
        <input
          className="input input--num set-row__input"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          step={1}
          value={reps}
          disabled={disabled}
          data-field="reps"
          aria-label={`Set ${index} repetitions`}
          onChange={(event) => changeReps(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void persist().then((saved) => {
              if (saved) onEnter();
            });
          }}
        />
        <span className="set-row__suffix">reps</span>
      </label>
      <button
        type="button"
        className="icon-button set-row__remove"
        onClick={onRemove}
        disabled={disabled}
        aria-label={draft ? 'Discard set' : 'Remove set'}
      >
        {saving ? <FiCheck aria-hidden="true" /> : <FiTrash2 aria-hidden="true" />}
      </button>
      {saving ? (
        <span className="set-row__saving" role="status">
          Saving…
        </span>
      ) : null}
      {error ? (
        <span className="set-row__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface SetLoggerProps {
  row: SessionExercise;
  editable: boolean;
  onLogSet: (set: SetLog) => Promise<void>;
  onUpdateSet: (setId: string, patch: Partial<SetLog>) => Promise<void>;
  onRemoveSet: (setId: string) => void;
  onSavingChange: (delta: number) => void;
}

interface Draft {
  id: string;
  weight: number;
  reps: number;
}

export function SetLogger({
  row,
  editable,
  onLogSet,
  onUpdateSet,
  onRemoveSet,
  onSavingChange,
}: SetLoggerProps) {
  const { settings } = useTrainer();
  const [draft, setDraft] = useState<Draft | null>(null);
  const focusDraft = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft && row.sets.some((set) => set.id === draft.id)) {
      setDraft(null);
    }
  }, [draft, row.sets]);

  useEffect(() => {
    if (!draft || !focusDraft.current) return;
    focusDraft.current = false;
    containerRef.current
      ?.querySelector<HTMLInputElement>('[data-draft="true"] [data-field="weight"]')
      ?.focus();
  }, [draft]);

  async function addSet(focus = false) {
    if (draft) {
      containerRef.current
        ?.querySelector<HTMLInputElement>('[data-draft="true"] [data-field="weight"]')
        ?.focus();
      return;
    }

    const previous = row.sets[row.sets.length - 1];
    if (!previous) {
      focusDraft.current = true;
      setDraft({
        id: crypto.randomUUID(),
        weight: 0,
        reps: row.targetRepMin,
      });
      return;
    }

    const set = {
      id: crypto.randomUUID(),
      weight: previous.weight,
      reps: previous.reps,
    };
    setDraft(null);
    try {
      await onLogSet(set);
      playFeedback(settings);
      if (focus) {
        const rows = containerRef.current?.querySelectorAll('[data-set-row]');
        const last = rows?.[rows.length - 1] as HTMLElement | undefined;
        last?.querySelector<HTMLInputElement>('[data-field="weight"]')?.focus();
      }
    } catch {
      // The store surfaces write failures; keep the logger usable.
    }
  }

  async function persistDraft(value: { weight: number; reps: number }) {
    if (!draft) return;
    const set = { id: draft.id, ...value };
    await onLogSet(set);
    playFeedback(settings);
    setDraft(null);
    if (focusDraft.current) {
      const rows = containerRef.current?.querySelectorAll('[data-set-row]');
      const last = rows?.[rows.length - 1] as HTMLElement | undefined;
      last?.querySelector<HTMLInputElement>('[data-field="weight"]')?.focus();
    }
  }

  return (
    <div className="set-logger" ref={containerRef}>
      {row.sets.map((set, index) => (
        <SetRow
          key={set.id}
          set={set}
          index={index + 1}
          unit={settings.weightUnit}
          disabled={!editable}
          onPersist={(patch) => onUpdateSet(set.id, patch)}
          onRemove={() => onRemoveSet(set.id)}
          onEnter={() => {
            const next = containerRef.current?.querySelectorAll<HTMLElement>('[data-set-row]')[
              index + 1
            ];
            if (next) {
              next.querySelector<HTMLInputElement>('[data-field="weight"]')?.focus();
            } else {
              addSet(true);
            }
          }}
          onSavingChange={onSavingChange}
        />
      ))}
      {draft ? (
        <SetRow
          key={draft.id}
          set={{ id: draft.id, weight: draft.weight, reps: draft.reps }}
          index={row.sets.length + 1}
          unit={settings.weightUnit}
          draft
          disabled={!editable}
          onPersist={persistDraft}
          onRemove={() => setDraft(null)}
          onEnter={() => addSet(true)}
          onSavingChange={onSavingChange}
        />
      ) : null}
      {editable ? (
        <button type="button" className="set-logger__add" onClick={() => void addSet()}>
          <FiPlus aria-hidden="true" />
          Add set
        </button>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {row.sets.length} logged {row.sets.length === 1 ? 'set' : 'sets'}
      </span>
    </div>
  );
}
