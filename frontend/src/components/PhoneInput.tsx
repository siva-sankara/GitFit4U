import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { parseIndianMobile } from "../services/authValidation";
import { isInternationalPhone, normalizeContactPhone, phoneDisplayValue } from "../services/contactPhoneInput";
import "../styles/phone-input.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "maxLength" | "minLength" | "pattern"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onValidityChange?: (invalid: boolean) => void;
  allowInternational?: boolean;
  valueFormat?: "canonical" | "local";
};

// One controlled editing policy for account, gym and secondary contact fields.
// A rejected paste leaves the previous value visible but blocks submission until corrected.
export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput({
  value, defaultValue = "", onValueChange, onValidityChange, allowInternational = true,
  valueFormat = "canonical", className = "input", onBlur, ...props
}, ref) {
  const errorId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const [chosenMode, setChosenMode] = useState<boolean>();
  const [error, setError] = useState("");
  const stored = value ?? uncontrolled;
  const international = allowInternational && (chosenMode ?? isInternationalPhone(stored));
  const displayed = phoneDisplayValue(stored, international);
  const message = international ? "Enter a valid phone number with its +country code." : "Enter a 10-digit mobile number.";
  const invalid = Boolean(error) || Boolean(displayed && !(international
    ? isInternationalPhone(displayed) && normalizeContactPhone(displayed)
    : /^\d{10}$/.test(displayed)));
  useEffect(() => {
    input.current?.setCustomValidity(error || (invalid ? message : ""));
  }, [error, invalid, message]);

  function reject() {
    setError(message);
    input.current?.setCustomValidity(message);
    onValidityChange?.(true);
  }
  function accept(next: string, completeOnly = false) {
    let nextValue: string | undefined;
    if (next === "" && !completeOnly) nextValue = "";
    else if (international) {
      if (!completeOnly && /^\+[0-9]{0,15}$/.test(next) && !next.startsWith("+91")) nextValue = next;
      else if (isInternationalPhone(next)) nextValue = normalizeContactPhone(next);
    } else if (!completeOnly && /^\d{0,10}$/.test(next)) nextValue = next;
    else nextValue = parseIndianMobile(next);
    if (nextValue === undefined) { reject(); return; }
    setError("");
    const complete = !nextValue || (international ? Boolean(normalizeContactPhone(nextValue)) : /^\d{10}$/.test(nextValue));
    input.current?.setCustomValidity(complete ? "" : message);
    onValidityChange?.(!complete);
    const result = valueFormat === "canonical" && nextValue ? normalizeContactPhone(nextValue) ?? nextValue : nextValue;
    setUncontrolled(result);
    onValueChange?.(result);
  }

  return <span className="phone-control">
    <span className={`phone-input-row ${className}`}>
      <input {...props} ref={element => {
        input.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }} type="tel" inputMode={international ? "tel" : "numeric"}
        autoComplete={international ? "tel" : "tel-national"}
        minLength={international ? 9 : 10} maxLength={international ? 16 : 10}
        pattern={international ? "\\+[1-9][0-9]{7,14}" : "[0-9]{10}"}
        value={displayed} aria-invalid={Boolean(error) || props["aria-invalid"] || undefined}
        aria-describedby={[props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined}
        onChange={event => accept(event.target.value)}
        onPaste={event => {
          event.preventDefault();
          const field = event.currentTarget;
          const pasted = event.clipboardData.getData("text");
          const replacement = displayed.slice(0, field.selectionStart ?? 0) + pasted + displayed.slice(field.selectionEnd ?? displayed.length);
          accept(replacement, true);
        }}
        onBlur={event => { if (invalid || (props.required && !displayed)) setError(message); onBlur?.(event); }} />
      {!international && <span className="phone-country-prefix" aria-hidden="true">+91</span>}
    </span>
    {allowInternational && <select className="phone-country-choice" aria-label={`${props["aria-label"] || props.name || "Phone"} number format`}
      disabled={props.disabled || props.readOnly} value={international ? "international" : "india"}
      onChange={event => {
        setChosenMode(event.target.value === "international");
        setUncontrolled(""); onValueChange?.(""); setError(""); onValidityChange?.(false);
      }}>
      <option value="india">India (+91)</option><option value="international">Other country (+code)</option>
    </select>}
    {error && <small id={errorId} className="phone-input-error" role="alert">{error}</small>}
  </span>;
});
