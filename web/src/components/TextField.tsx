type TextFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
};

/**
 * One labelled input with its error or hint message.
 *
 * This is a component rather than repeated JSX mainly for the accessibility
 * wiring: htmlFor/id ties the label to the input so clicking the label focuses
 * it, aria-invalid announces the error state to a screen reader, and
 * aria-describedby points at the text explaining it. Repeating that correctly
 * across eight inputs by hand is where it silently stops being correct.
 */
export function TextField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
}: TextFieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        className={`field-input${error ? ' field-input-error' : ''}`}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
