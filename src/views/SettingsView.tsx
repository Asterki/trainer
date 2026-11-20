/** Settings — appearance, training, custom exercises, data and about. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiActivity,
  FiDatabase,
  FiDownload,
  FiEdit2,
  FiInfo,
  FiList,
  FiMoon,
  FiPlus,
  FiSearch,
  FiSun,
  FiTrash2,
  FiUpload,
} from 'react-icons/fi';
import { BottomSheet } from '../components/BottomSheet';
import { BrandMark } from '../components/BrandMark';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CustomExerciseForm } from '../components/CustomExerciseForm';
import {
  EQUIPMENT,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  EQUIPMENT_LABELS,
  EXERCISE_CATEGORY_LABELS,
} from '../domain/catalogue/groups';
import { loadCatalogue, searchExercises } from '../domain/catalogue/wger';
import {
  downloadBackup,
  readBackupFile,
} from '../domain/backup';
import type {
  BackupFile,
  EquipmentId,
  Exercise,
  MuscleGroupId,
} from '../domain/types';
import { useDebouncedValue } from '../state/hooks';
import { useTrainer } from '../state/store';
import { themeSettingOf } from '../state/theme';

type NoticeKind = 'ok' | 'warn' | 'error';

interface Notice {
  kind: NoticeKind;
  text: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function NoticeLine({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button type="button" className="notice__dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-row__copy">
        <span className="toggle-row__label">{label}</span>
        <span className="toggle-row__hint">{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        className={`switch${checked ? ' switch--on' : ''}`}
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

function persistenceLabel(state: 'checking' | 'unsupported' | 'persistent' | 'best-effort') {
  if (state === 'checking') return 'Checking…';
  if (state === 'unsupported') return 'Unavailable in this browser';
  if (state === 'persistent') return 'Persistent — protected from eviction';
  return 'Best effort — the browser may evict data';
}

export function SettingsView() {
  const {
    routines,
    sessions,
    customExercises,
    settings,
    updateSettings,
    deleteCustomExercise,
    buildBackup,
    restoreBackup,
    resetEverything,
  } = useTrainer();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [editorFor, setEditorFor] = useState<Exercise | 'new' | null>(null);
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroupId | ''>('');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentId | ''>('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Exercise | null>(null);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [persistence, setPersistence] = useState<
    'checking' | 'unsupported' | 'persistent' | 'best-effort'
  >('checking');
  const importRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 150);

  useEffect(() => {
    let cancelled = false;
    loadCatalogue(customExercises)
      .then((rows) => {
        if (cancelled) return;
        setCatalogue(rows);
        setCatalogueFailed(false);
      })
      .catch(() => {
        if (!cancelled) setCatalogueFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customExercises]);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (!navigator.storage?.persisted) {
        if (!cancelled) setPersistence('unsupported');
        return;
      }
      navigator.storage
        .persisted()
        .then((persisted) => {
          if (!cancelled) setPersistence(persisted ? 'persistent' : 'best-effort');
        })
        .catch(() => {
          if (!cancelled) setPersistence('best-effort');
        });
    };
    read();
    const timer = window.setTimeout(read, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const results = useMemo(
    () =>
      searchExercises(catalogue, {
        query: debouncedQuery,
        muscle: muscleFilter || null,
        equipment: equipmentFilter || null,
        limit: 8,
      }),
    [catalogue, debouncedQuery, muscleFilter, equipmentFilter],
  );

  const customCount = customExercises.length;

  function handleSaved(exercise: Exercise) {
    setEditorFor(null);
    setNotice({
      kind: 'ok',
      text: `${editorFor === 'new' ? 'Created' : 'Updated'} “${exercise.name}”.`,
    });
  }

  async function confirmDelete() {
    const exercise = pendingDelete;
    if (!exercise) return;
    setPendingDelete(null);
    try {
      await deleteCustomExercise(exercise.id);
      setNotice({ kind: 'ok', text: `Deleted “${exercise.name}”.` });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  }

  function handleExport() {
    try {
      downloadBackup(buildBackup());
      setNotice({ kind: 'ok', text: 'Backup downloaded.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const backup = await readBackupFile(file);
      setPendingImport(backup);
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
      if (importRef.current) importRef.current.value = '';
    }
  }

  function cancelImport() {
    setPendingImport(null);
    if (importRef.current) importRef.current.value = '';
  }

  async function confirmImport() {
    const backup = pendingImport;
    if (!backup) return;
    setPendingImport(null);
    try {
      await restoreBackup(backup);
      setNotice({
        kind: 'ok',
        text: `Imported ${backup.routines.length} routines, ${backup.sessions.length} sessions and ${backup.customExercises.length} custom exercises.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function handleReset() {
    if (deleteConfirm !== 'DELETE') return;
    setResetting(true);
    try {
      await resetEverything();
    } catch (error) {
      setResetting(false);
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  }

  return (
    <div className="view">
      <header className="view__header view__header--hero">
        <div>
          <span className="view__eyebrow">Settings</span>
          <h1 className="view__title">Settings</h1>
        </div>
      </header>

      {notice && <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />}

      <section className="card settings-card" aria-labelledby="settings-appearance">
        <div className="settings-card__head">
          <span className="settings-card__icon">
            {settings.theme === 'nordic-dark' ? <FiMoon aria-hidden="true" /> : <FiSun aria-hidden="true" />}
          </span>
          <div>
            <h2 className="card__title" id="settings-appearance">
              Appearance
            </h2>
            <p className="card__hint">Choose the surface that suits the room.</p>
          </div>
        </div>

        <div className="segmented" role="group" aria-label="Theme">
          <button
            type="button"
            className={`segmented__item${settings.theme === 'nordic-light' ? ' segmented__item--active' : ''}`}
            onClick={() => void updateSettings({ theme: themeSettingOf('light') })}
            aria-pressed={settings.theme === 'nordic-light'}
          >
            Light
          </button>
          <button
            type="button"
            className={`segmented__item${settings.theme === 'nordic-dark' ? ' segmented__item--active' : ''}`}
            onClick={() => void updateSettings({ theme: themeSettingOf('dark') })}
            aria-pressed={settings.theme === 'nordic-dark'}
          >
            Dark
          </button>
        </div>
      </section>

      <section className="card settings-card" aria-labelledby="settings-training">
        <div className="settings-card__head">
          <span className="settings-card__icon">
            <FiActivity aria-hidden="true" />
          </span>
          <div>
            <h2 className="card__title" id="settings-training">
              Training
            </h2>
            <p className="card__hint">Feedback while you log sets.</p>
          </div>
        </div>

        <div className="toggle-list">
          <ToggleRow
            label="Sound"
            hint="Play a short cue when a set is completed."
            checked={settings.soundEnabled}
            onChange={(checked) => void updateSettings({ soundEnabled: checked })}
          />
          <ToggleRow
            label="Haptics"
            hint="Use a short vibration on supported phones."
            checked={settings.hapticsEnabled}
            onChange={(checked) => void updateSettings({ hapticsEnabled: checked })}
          />
        </div>
      </section>

      <section className="card settings-card" aria-labelledby="settings-exercises">
        <div className="settings-card__head">
          <span className="settings-card__icon">
            <FiList aria-hidden="true" />
          </span>
          <div>
            <h2 className="card__title" id="settings-exercises">
              Exercises
            </h2>
            <p className="card__hint">
              {catalogue.length > 0
                ? `${catalogue.length} exercises available, ${customCount} custom.`
                : `${customCount} custom exercises.`}
            </p>
          </div>
          <button
            type="button"
            className="button button--primary settings-card__action"
            onClick={() => setEditorFor('new')}
          >
            <FiPlus aria-hidden="true" /> New exercise
          </button>
        </div>

        <div className="search-field">
          <FiSearch aria-hidden="true" />
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the exercise catalogue"
            aria-label="Search exercises"
          />
        </div>

        <div className="catalogue-filters">
          <label className="field">
            <span className="field__label">Muscle</span>
            <select
              className="input"
              value={muscleFilter}
              onChange={(event) => setMuscleFilter(event.target.value as MuscleGroupId | '')}
            >
              <option value="">Any muscle</option>
              {MUSCLE_GROUPS.map((muscle) => (
                <option key={muscle.id} value={muscle.id}>
                  {muscle.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Equipment</span>
            <select
              className="input"
              value={equipmentFilter}
              onChange={(event) => setEquipmentFilter(event.target.value as EquipmentId | '')}
            >
              <option value="">Any equipment</option>
              {EQUIPMENT.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {catalogueFailed && (
          <p className="settings-note">The catalogue could not be loaded. Custom exercises still work.</p>
        )}

        {debouncedQuery || muscleFilter || equipmentFilter ? (
          <div className="catalogue-results" aria-live="polite">
            {results.length === 0 ? (
              <p className="empty-note">
                {debouncedQuery ? `No exercises match “${debouncedQuery}”.` : 'No exercises match those filters.'}
              </p>
            ) : (
              results.map((exercise) => (
                <div className="catalogue-result" key={exercise.id}>
                  <div className="catalogue-result__main">
                    <span className="catalogue-result__name">{exercise.name}</span>
                    <span className="catalogue-result__meta">
                      {EXERCISE_CATEGORY_LABELS[exercise.category]} ·{' '}
                      {exercise.primaryMuscles.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(', ')}
                      {exercise.equipment.length > 0 &&
                        ` · ${exercise.equipment.map((item) => EQUIPMENT_LABELS[item]).join(', ')}`}
                    </span>
                  </div>
                  <span className="badge badge--quiet">
                    {exercise.source === 'custom' ? 'Custom' : 'wger'}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <p className="settings-note">
            Search the catalogue to check names before creating a custom exercise.
          </p>
        )}

        <div className="settings-subhead">
          <h3 className="settings-subhead__title">Custom exercises</h3>
        </div>

        {customExercises.length === 0 ? (
          <p className="empty-note">
            No custom exercises yet. Create one when the catalogue lacks a movement you use.
          </p>
        ) : (
          <ul className="exercise-list">
            {customExercises.map((exercise) => (
              <li className="exercise-row" key={exercise.id}>
                <div className="exercise-row__main">
                  <span className="exercise-row__name">{exercise.name}</span>
                  <span className="exercise-row__meta">
                    {EXERCISE_CATEGORY_LABELS[exercise.category]} ·{' '}
                    {exercise.primaryMuscles.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(', ')}
                  </span>
                </div>
                <div className="exercise-row__actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setEditorFor(exercise)}
                    aria-label={`Edit ${exercise.name}`}
                    title="Edit"
                  >
                    <FiEdit2 aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => setPendingDelete(exercise)}
                    aria-label={`Delete ${exercise.name}`}
                    title="Delete"
                  >
                    <FiTrash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card settings-card" aria-labelledby="settings-data">
        <div className="settings-card__head">
          <span className="settings-card__icon">
            <FiDatabase aria-hidden="true" />
          </span>
          <div>
            <h2 className="card__title" id="settings-data">
              Data
            </h2>
            <p className="card__hint">Portable, local and entirely yours.</p>
          </div>
        </div>

        <dl className="data-stats">
          <div>
            <dt>Routines</dt>
            <dd>{routines.length}</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>{sessions.length}</dd>
          </div>
          <div>
            <dt>Custom exercises</dt>
            <dd>{customExercises.length}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{persistenceLabel(persistence)}</dd>
          </div>
        </dl>

        <div className="settings-actions">
          <button type="button" className="button" onClick={handleExport}>
            <FiDownload aria-hidden="true" /> Export backup
          </button>
          <button type="button" className="button" onClick={() => importRef.current?.click()}>
            <FiUpload aria-hidden="true" /> Import backup
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
        </div>
        <p className="settings-note">
          Import is replace-only and blocked while sync is connected. Backup files contain routines,
          sessions, custom exercises and settings — never the seeded catalogue.
        </p>

        <div className="danger-zone">
          <div>
            <h3 className="settings-subhead__title">Delete all Trainer data</h3>
            <p className="settings-note">
              Removes the Trainer database from this browser. It never touches another app's data.
              Type <strong>DELETE</strong> to enable the button.
            </p>
          </div>
          <div className="danger-zone__action">
            <label className="field__label" htmlFor="delete-confirm">
              Confirmation
            </label>
            <input
              id="delete-confirm"
              className="input"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
            <button
              type="button"
              className="button button--danger"
              disabled={deleteConfirm !== 'DELETE' || resetting}
              onClick={() => void handleReset()}
            >
              <FiTrash2 aria-hidden="true" /> {resetting ? 'Deleting…' : 'Delete all Trainer data'}
            </button>
          </div>
        </div>
      </section>

      <section className="card settings-card" aria-labelledby="settings-about">
        <div className="settings-about">
          <span className="settings-about__mark">
            <BrandMark />
          </span>
          <div>
            <h2 className="card__title" id="settings-about">
              About Trainer
            </h2>
            <p className="card__hint">A local-first routine builder and workout logger.</p>
          </div>
        </div>

        <dl className="about-list">
          <div>
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>This browser (IndexedDB)</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>Not required</dd>
          </div>
          <div>
            <dt>Offline</dt>
            <dd>Installable PWA; the shell and last loaded catalogue work offline.</dd>
          </div>
        </dl>

        <p className="settings-note">
          <FiInfo aria-hidden="true" /> Trainer has no in-app AI and no reminder engine. Sound and
          haptics are used only while logging sets in a later stage.
        </p>

        <div className="catalogue-attribution">
          <h3 className="settings-subhead__title">Exercise catalogue</h3>
          <p className="settings-note">
            Exercise text and metadata come from{' '}
            <a href="https://wger.de" target="_blank" rel="noreferrer">
              wger
            </a>{' '}
            under{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/deed.en"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>
            ,{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/3.0/deed.en"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 3.0
            </a>{' '}
            and{' '}
            <a
              href="https://creativecommons.org/publicdomain/zero/1.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC0
            </a>{' '}
            terms. Trainer maps names into its own taxonomy, strips HTML and bundles no images. See{' '}
            <code>ATTRIBUTION.md</code> in the source repository for authors and license details.
          </p>
        </div>
      </section>

      <BottomSheet
        open={editorFor !== null}
        title={editorFor === 'new' ? 'New exercise' : 'Edit exercise'}
        onClose={() => setEditorFor(null)}
      >
        {editorFor !== null && (
          <CustomExerciseForm
            key={editorFor === 'new' ? 'new' : editorFor.id}
            exercise={editorFor === 'new' ? undefined : editorFor}
            onClose={() => setEditorFor(null)}
            onSaved={handleSaved}
          />
        )}
      </BottomSheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete exercise?"
        confirmLabel="Delete exercise"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>
          Delete “{pendingDelete?.name}”? Existing sessions keep their exercise snapshots. You can
          recreate the exercise later, but its id will change.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingImport !== null}
        title="Replace all Trainer data?"
        confirmLabel="Replace data"
        tone="danger"
        onCancel={cancelImport}
        onConfirm={() => void confirmImport()}
      >
        <p>
          This device: {routines.length} routines, {sessions.length} sessions,{' '}
          {customExercises.length} custom exercises.
        </p>
        <p>
          Backup: {pendingImport?.routines.length ?? 0} routines,{' '}
          {pendingImport?.sessions.length ?? 0} sessions,{' '}
          {pendingImport?.customExercises.length ?? 0} custom exercises.
        </p>
        <p>Import is replace-only. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
