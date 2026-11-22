/**
 * In-app user manual.
 *
 * Mirrors USER_MANUAL.md at the repository root: when one changes, change the
 * other. Rendered as structured JSX so the app ships no Markdown parser.
 */

const link = { target: '_blank', rel: 'noreferrer' } as const;

export function UserManual() {
  return (
    <div className="manual">
      <p className="manual__lead">
        Trainer is a personal routine builder and workout log. Plan a repeating cycle of weeks and
        weekdays, log the weight and reps of every set, and let Trainer derive your records, volume,
        adherence and history. No account, no ads, no analytics, no in-app AI — your data lives in
        this browser first.
      </p>

      <section>
        <h3>Install and offline use</h3>
        <p>
          Open Trainer in a modern browser, then install it or add it to your home screen. The first
          load caches the app shell; exercise media is cached as you browse it. Without a connection
          you can still build routines, log sets and read history. When sync is on, changes queue
          locally and upload on reconnect. The last plan you received stays visible offline.
        </p>
      </section>

      <section>
        <h3>Building a routine</h3>
        <p>
          Open <strong>Routine</strong>, press <strong>New routine</strong>, and set a name, start
          date and 1–12 weeks. Press a slot in the weekly grid and choose <strong>Workout</strong>{' '}
          with a focus label, or <strong>Rest</strong>; a slot can carry a short note. Copy the
          previous week, clear a week, or add and remove weeks as needed. Press{' '}
          <strong>Activate</strong> — exactly one routine is active at a time, and it drives Today.
        </p>
        <p>
          A routine slot owns only the focus/rest label and its note. It never lists exercises —
          those come from the generated session or from you.
        </p>
        <p>
          The grid works with the keyboard: Tab moves between slots, arrow keys move around the grid,
          Enter opens the slot editor, Escape closes it.
        </p>
      </section>

      <section>
        <h3>Today and its statuses</h3>
        <p>
          Today shows the date, your current streak, today&apos;s slot and session. The badge tells
          you what to expect:
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>No routine</td>
              <td>Nothing is active. Build a routine, or log a one-off workout.</td>
            </tr>
            <tr>
              <td>Rest / Rest day</td>
              <td>Today&apos;s slot is rest. No session or history is created.</td>
            </tr>
            <tr>
              <td>Upcoming / Scheduled</td>
              <td>
                The active routine starts in the future. Nothing is created before the start date.
              </td>
            </tr>
            <tr>
              <td>No session today</td>
              <td>
                A scheduled workout the app has not prepared yet. Use <strong>Log a workout</strong>.
              </td>
            </tr>
            <tr>
              <td>Plan pending</td>
              <td>No exercises yet. Add them yourself or wait for your n8n workflow.</td>
            </tr>
            <tr>
              <td>Planned</td>
              <td>Exercises and target sets are ready.</td>
            </tr>
            <tr>
              <td>In progress</td>
              <td>At least one set is logged.</td>
            </tr>
            <tr>
              <td>Completed</td>
              <td>Finished. Reopen on the same day if you need to fix something.</td>
            </tr>
            <tr>
              <td>Skipped</td>
              <td>The day passed without a completed session. Read-only.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Sessions are created only for scheduled workout days. Rest days, days before the routine
          starts and days outside the cycle never create sessions. Log an unscheduled workout with{' '}
          <strong>Log a workout</strong>; it appears in History but not in adherence.
        </p>
      </section>

      <section>
        <h3>Logging sets</h3>
        <ol>
          <li>Enter the weight in kilograms. <code>0</code> means bodyweight; two decimals allowed.</li>
          <li>Enter the reps — a whole number from 1 to 999.</li>
          <li>Press <strong>Enter</strong> or the check button to commit the set.</li>
          <li>Use <strong>Add set</strong> for another set.</li>
          <li>Add a session note and a rating from 1 (drained) to 5 (fresh).</li>
          <li>Press <strong>Finish</strong> when the workout is done.</li>
        </ol>
        <p>
          Finishing with no sets asks for confirmation. A completed session is terminal at midnight:
          reopen it during the same day, but after that it is history. Weight is stored in kilograms;
          if you choose pounds in Settings, Trainer converts for display and input.
        </p>
        <p>
          <strong>Bodyweight sets</strong> use <code>0</code> kg. They count as sets and reps, but
          contribute no volume and never create a weight PR.
        </p>
      </section>

      <section>
        <h3>Missed days</h3>
        <p>
          Scheduled workout days from the last 13 days that have no completed session are backfilled
          as <strong>Skipped</strong>; planned sessions whose date has passed are also closed. Skipped
          sessions are read-only and count against adherence. Rest days stay rest, and days before a
          routine starts stay empty.
        </p>
      </section>

      <section>
        <h3>Progress</h3>
        <p>
          Progress has <strong>Overview</strong>, <strong>Exercises</strong> and{' '}
          <strong>Muscles</strong> tabs. Everything is computed from completed sessions; nothing is
          stored twice.
        </p>
        <ul>
          <li>
            <strong>Personal record</strong> — the heaviest weight logged for a given rep count. A tie
            goes to the earliest date. Bodyweight sets are excluded.
          </li>
          <li>
            <strong>Volume</strong> — weight × reps. Primary muscles get full credit, secondary
            muscles half. Weekly muscle volume groups sessions by ISO week.
          </li>
          <li>
            <strong>Adherence</strong> — completed ÷ (completed + skipped) for scheduled workout days
            in the selected weeks. Rest days and ad-hoc sessions are excluded.
          </li>
          <li>
            <strong>Streak</strong> — consecutive completed scheduled sessions in date order. A skip
            resets the current streak; your best streak is kept.
          </li>
          <li>
            <strong>Estimated 1RM</strong> — a derived estimate from a top set, shown for context. It
            is not a PR.
          </li>
        </ul>
        <p>
          Charts are SVG with text and table equivalents for screen readers.
        </p>
      </section>

      <section>
        <h3>History</h3>
        <p>
          History lists sessions newest first, grouped by month. Filter by focus, exercise or date
          range; <strong>Clear filters</strong> resets them and <strong>Load more</strong> extends the
          list. Open a session to see its exercises, target sets, logged sets and notes. History is
          read-only: past and skipped sessions cannot be edited.
        </p>
      </section>

      <section>
        <h3>Exercise catalogue and custom exercises</h3>
        <p>
          The seeded catalogue comes from{' '}
          <a href="https://wger.de/" {...link}>
            wger
          </a>{' '}
          with muscles, equipment, category, instructions, aliases and images where available. Search
          it from the exercise picker or from <strong>Settings → Exercises</strong>.
        </p>
        <p>
          Settings → Exercises also lets you create, edit and delete <strong>custom exercises</strong>{' '}
          with a name, category, primary and secondary muscles, equipment, aliases and instructions.
          Deleting requires typing <code>DELETE</code>. Seeded exercises cannot be edited. Sessions
          snapshot exercise names and muscles, so later catalogue changes never rewrite history.
        </p>
      </section>

      <section>
        <h3>AI plan, relay and n8n</h3>
        <p>
          Trainer never calls an AI and holds no provider key. The optional loop is: you run the relay
          over HTTPS; in <strong>Settings → Sync</strong> you enter its URL and a passphrase of at
          least 8 characters; your n8n workflow reads <code>GET /api/v1/context</code>, asks your model
          for exercises and target sets, and writes{' '}
          <code>PUT /api/v1/sessions/{'{date}'}</code> with{' '}
          <code>Authorization: Bearer &lt;passphrase&gt;</code>. The plan reaches your devices through
          normal encrypted sync.
        </p>
        <p>
          The AI prescribes exercises, sets and rep ranges only — never weight. Writes use a catalogue
          id or an exact resolved name; unknown names return <code>422</code>, ambiguous names{' '}
          <code>409</code>, and a completed, skipped or already-logged session cannot be overwritten.
          The API accepts one plan per date, from yesterday through 14 days ahead, so a workflow can
          plan up to two weeks in advance. The plan stays <strong>Plan pending</strong> until it has
          exercises, and you can edit it on the day.
        </p>
        <p className="manual__warning">
          <strong>Security warning.</strong> Your passphrase derives the encryption key and
          authenticates the API. Anyone who has it can read and write your training space. Never put
          it in an n8n node, workflow JSON, prompt, log or notification — store it in an n8n{' '}
          <strong>Header Auth</strong> credential. Serve the relay over TLS only. Self-hosting means
          you own backups, updates and access control.
        </p>
        <p>
          Setup: <code>docs/ai/n8n-workflow.md</code>, the API contract in{' '}
          <code>docs/api/openapi.json</code>, and <strong>Copy API setup</strong> in the Sync card.
        </p>
      </section>

      <section>
        <h3>Backup, import and reset</h3>
        <p>
          <strong>Settings → Data</strong> shows counts and storage status.{' '}
          <strong>Export backup</strong> downloads one JSON file with routines, sessions, custom
          exercises and settings; the seeded catalogue is not included.{' '}
          <strong>Import backup</strong> replaces everything in this browser and is blocked while
          sync is connected. <strong>Delete all Trainer data</strong> removes the local database after
          you type <code>DELETE</code> — export first, it cannot be undone.
        </p>
      </section>

      <section>
        <h3>Settings</h3>
        <ul>
          <li>
            <strong>Appearance</strong> — theme (Nordic light/dark/system), sound, haptics.
          </li>
          <li>
            <strong>Training</strong> — weight unit for display and input (kg/lb).
          </li>
          <li>
            <strong>Body</strong> — height in centimetres and body weight.
          </li>
          <li>
            <strong>Exercises</strong> — catalogue search and custom exercises.
          </li>
          <li>
            <strong>Sync</strong> — relay URL, passphrase, connection, pending changes, last sync,
            space fingerprint, copy API setup.
          </li>
          <li>
            <strong>Data</strong> — counts, export, import, reset.
          </li>
          <li>
            <strong>About</strong> — version, storage, catalogue and media credits.
          </li>
        </ul>
      </section>

      <section>
        <h3>Keyboard shortcuts</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <kbd>1</kbd>–<kbd>5</kbd>
              </td>
              <td>Today, Routine, Progress, History, Settings</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Close a sheet, dialog or overlay</td>
            </tr>
            <tr>
              <td>
                <kbd>Enter</kbd>
              </td>
              <td>Commit the set you are editing</td>
            </tr>
            <tr>
              <td>Arrow keys</td>
              <td>Move between routine slots</td>
            </tr>
          </tbody>
        </table>
        <p>Shortcuts are ignored while you type in an input.</p>
      </section>

      <section>
        <h3>Troubleshooting</h3>
        <ul>
          <li>
            <strong>Sync will not connect</strong> — use an HTTPS, reachable relay URL and a passphrase
            of at least 8 characters that matches your other device. A new passphrase creates a new,
            empty space.
          </li>
          <li>
            <strong>Changes stay pending</strong> — you are offline; they upload on the next
            successful sync.
          </li>
          <li>
            <strong>Plan stays pending</strong> — the n8n workflow has not written today&apos;s
            session. Check its run history and the relay&apos;s <code>/health</code>.
          </li>
          <li>
            <strong>A plan was rejected</strong> — <code>422</code> means an unknown exercise name and{' '}
            <code>409</code> an ambiguous one; send a catalogue id or an exact existing name.
          </li>
          <li>
            <strong>Today looks wrong after midnight</strong> — reload; the app rolls over at local
            midnight and closes yesterday&apos;s session.
          </li>
          <li>
            <strong>The app shows an old version</strong> — reload once so the new service worker
            activates.
          </li>
          <li>
            <strong>Data disappeared</strong> — browser storage was cleared or a different profile is
            in use. Restore a backup or reconnect sync to a space that still has the data.
          </li>
        </ul>
      </section>

      <section>
        <h3>Data and privacy</h3>
        <p>
          Routines, sessions, custom exercises and settings live in this browser&apos;s{' '}
          <code>trainer</code> IndexedDB database. Without sync, no training data leaves the device.
          With sync, entities are encrypted here and the relay stores ciphertext plus change metadata;
          it decrypts in memory only to build the report and validate AI writes. There is no telemetry
          and no third-party script. Clearing site data deletes local Trainer data — export a backup if
          you do not use sync.
        </p>
      </section>

      <section>
        <h3>wger attribution</h3>
        <p>
          Exercise text, metadata and media come from{' '}
          <a href="https://wger.de/" {...link}>
            wger
          </a>
          . Records are licensed CC BY-SA 4.0, CC BY-SA 3.0 or CC0; author and licence are kept with
          each record and shown with each image. Trainer bundles no videos. The body diagram vendors
          MIT-licensed polygon data from <code>@mjcdev/react-body-highlighter</code>. Full credits:{' '}
          <code>src/domain/catalogue/ATTRIBUTION.md</code>.
        </p>
      </section>
    </div>
  );
}
