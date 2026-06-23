"use client";

export function StarGroup({
  id,
  name,
  value,
  onChange,
}: {
  id: number;
  name: string;
  value: number;
  onChange: (stars: number) => void;
}) {
  return (
    <fieldset className="flex items-center justify-between py-1">
      <legend className="text-sm">{name}</legend>
      <span className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const inputId = `dim-${id}-star-${n}`;
          return (
            <span key={n} className="inline-flex">
              <input
                type="radio"
                id={inputId}
                name={`dim-${id}`}
                value={n}
                checked={value === n}
                aria-label={`${name}: ${n} star${n > 1 ? "s" : ""}`}
                onChange={() => onChange(n)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                aria-hidden="true"
                className={`cursor-pointer text-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#0A357E] ${
                  value >= n ? "text-[#F2C200]" : "text-slate-300"
                }`}
              >
                ★
              </label>
            </span>
          );
        })}
      </span>
    </fieldset>
  );
}
