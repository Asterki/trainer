import { FiCheck } from 'react-icons/fi';

interface FinishBarProps {
  sets: number;
  disabled: boolean;
  onFinish: () => void;
}

export function FinishBar({ sets, disabled, onFinish }: FinishBarProps) {
  return (
    <div className="finish-bar" role="region" aria-label="Finish workout">
      <div className="finish-bar__copy">
        <strong>
          {sets} {sets === 1 ? 'set' : 'sets'} logged
        </strong>
        <span>Finish when the session is done.</span>
      </div>
      <button type="button" className="button button--primary" onClick={onFinish} disabled={disabled}>
        <FiCheck aria-hidden="true" />
        Finish workout
      </button>
    </div>
  );
}
