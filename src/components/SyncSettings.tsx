import { useCallback, useEffect, useState } from 'react';
import { FiCloud, FiCopy, FiLink, FiRefreshCw } from 'react-icons/fi';
import { ConfirmDialog } from './ConfirmDialog';
import {
  connectSync,
  disconnectSync,
  getSyncInfo,
  getSyncStatus,
  subscribeSync,
  syncNow,
} from '../sync/engine';
import { NewSyncSpaceError, type SyncInfo, type SyncStatus } from '../sync/types';

const DEFAULT_RELAY = 'http://localhost:8787';

function syncError(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync could not be updated.';
}

function formatTime(value: number): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_RELAY);
  const [deviceName, setDeviceName] = useState('This browser');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const refreshInfo = useCallback(async () => {
    const next = await getSyncInfo();
    setInfo(next);
    if (next) {
      setServerUrl(next.serverUrl);
      setDeviceName(next.deviceName);
    }
  }, []);

  useEffect(() => subscribeSync(setStatus), []);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo, status.configured, status.state]);

  const connect = async (allowCreate: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await connectSync(serverUrl, passphrase, allowCreate, deviceName);
      setPassphrase('');
      setCreateOpen(false);
      setNotice(
        result.created
          ? 'Sync space created. This device is now connected.'
          : 'Connected to the existing sync space.',
      );
      await refreshInfo();
    } catch (nextError) {
      if (nextError instanceof NewSyncSpaceError) {
        setCreateOpen(true);
      } else {
        setError(syncError(nextError));
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectSync();
      setInfo(null);
      setPassphrase('');
      setNotice('Disconnected. Local Trainer data is unchanged.');
      setDisconnectOpen(false);
    } catch (nextError) {
      setError(syncError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const copyApiSetup = async () => {
    const base = (info?.serverUrl ?? serverUrl).replace(/\/+$/, '');
    const text = [
      `Relay: ${base}`,
      'Authorization: Bearer <sync passphrase>',
      `OpenAPI: ${base}/api/v1/openapi.json`,
      `Context: ${base}/api/v1/context?date=YYYY-MM-DD`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('API setup copied.');
    } catch {
      setError('Could not copy. Select the setup details manually.');
    }
  };

  const stateLabel =
    status.state === 'off'
      ? 'Off'
      : status.state === 'idle'
        ? 'Up to date'
        : status.state === 'syncing'
          ? 'Syncing'
          : 'Needs attention';

  return (
    <section className="card settings-card" aria-labelledby="settings-sync-title">
      <header className="settings-card__head">
        <span className="settings-card__icon" aria-hidden="true">
          <FiCloud />
        </span>
        <div>
          <h2 className="card__title" id="settings-sync-title">
            Sync and AI relay
          </h2>
          <p className="card__hint">
            Optional encrypted sync and the authenticated API your n8n workflow calls.
          </p>
        </div>
        <span className={`badge badge--${status.state === 'error' ? 'danger' : 'quiet'}`}>
          {stateLabel}
        </span>
      </header>

      <div className="settings-card__body sync-settings">
        <p className="settings-note">
          The passphrase encrypts routine and workout data on the relay. It also authorizes the
          AI API, so use a long, unique passphrase and keep it out of the browser URL.
        </p>

        {info ? (
          <div className="sync-status">
            <div>
              <span className="sync-status__label">Relay</span>
              <span className="sync-status__value">{info.serverUrl}</span>
            </div>
            <div>
              <span className="sync-status__label">Device</span>
              <span className="sync-status__value">{info.deviceName}</span>
            </div>
            <div>
              <span className="sync-status__label">Pending</span>
              <span className="sync-status__value">{status.pending}</span>
            </div>
            <div>
              <span className="sync-status__label">Last sync</span>
              <span className="sync-status__value">{formatTime(status.lastSyncAt)}</span>
            </div>
            <div className="sync-status__wide">
              <span className="sync-status__label">Space fingerprint</span>
              <code className="sync-fingerprint">{info.fingerprint}</code>
            </div>
          </div>
        ) : (
          <div className="sync-form">
            <label className="field">
              <span>Relay URL</span>
              <input
                className="input"
                type="url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder={DEFAULT_RELAY}
                autoComplete="url"
              />
            </label>
            <label className="field">
              <span>Sync passphrase</span>
              <input
                className="input"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="field">
              <span>Device name</span>
              <input
                className="input"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={60}
              />
            </label>
            <div className="sync-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void connect(false)}
                disabled={busy || passphrase.trim().length < 8 || !serverUrl.trim()}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {info && (
          <>
            <div className="sync-actions">
              <button
                type="button"
                className="button"
                onClick={() => void syncNow()}
                disabled={status.state === 'syncing'}
              >
                <FiRefreshCw aria-hidden="true" /> Sync now
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setDisconnectOpen(true)}
                disabled={busy}
              >
                Disconnect
              </button>
            </div>

            <div className="sync-api">
              <div className="sync-api__head">
                <h3>API setup</h3>
                <button type="button" className="button button--quiet" onClick={() => void copyApiSetup()}>
                  <FiCopy aria-hidden="true" /> Copy
                </button>
              </div>
              <p>
                n8n should call <code>{info.serverUrl}/api/v1</code> with header{' '}
                <code>Authorization: Bearer &lt;sync passphrase&gt;</code>.
              </p>
              <a
                href={`${info.serverUrl}/api/v1/openapi.json`}
                target="_blank"
                rel="noreferrer"
              >
                <FiLink aria-hidden="true" /> OpenAPI specification
              </a>
            </div>
          </>
        )}

        {error && <p className="notice notice--error">{error}</p>}
        {notice && (
          <p className="notice notice--ok" role="status">
            {notice}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={createOpen}
        title="Create a new sync space?"
        confirmLabel="Create space"
        onCancel={() => setCreateOpen(false)}
        onConfirm={() => void connect(true)}
      >
        <p>
          No existing data was found for this passphrase. Creating a new space uploads this
          device&apos;s current Trainer data under that passphrase.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={disconnectOpen}
        title="Disconnect sync?"
        confirmLabel="Disconnect"
        tone="danger"
        onCancel={() => setDisconnectOpen(false)}
        onConfirm={() => void disconnect()}
      >
        <p>
          Local routines and workouts stay on this device. The relay copy remains under the same
          passphrase. Reconnecting with a different passphrase joins a different space.
        </p>
      </ConfirmDialog>
    </section>
  );
}
