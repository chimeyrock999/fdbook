export function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="studio-field-error">{message}</span> : null;
}
