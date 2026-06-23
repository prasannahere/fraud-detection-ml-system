import { InputHTMLAttributes, ReactNode } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  required?: boolean;
  prefix?: ReactNode;
  mono?: boolean;
};

export function Input({
  label,
  hint,
  required,
  prefix,
  mono,
  className = "",
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className={`input-field ${className}`}>
      <label className="input-label" htmlFor={inputId}>
        {label}
        {required && <span className="input-required">Required</span>}
      </label>
      <div className={`input-wrap ${prefix ? "has-prefix" : ""}`}>
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          id={inputId}
          className={`input ${mono ? "input-mono" : ""}`}
          {...props}
        />
      </div>
      {hint && <span className="input-hint">{hint}</span>}
    </div>
  );
}
