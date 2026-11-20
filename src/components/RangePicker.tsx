interface RangePickerProps {
  value: number;
  onChange: (weeks: number) => void;
  options?: number[];
  label?: string;
}

export function RangePicker({
  value,
  onChange,
  options = [4, 12, 26],
  label = 'Range',
}: RangePickerProps) {
  return (
    <div className="segmented range-picker" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`segmented__item${value === option ? ' segmented__item--active' : ''}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option} weeks
        </button>
      ))}
    </div>
  );
}
