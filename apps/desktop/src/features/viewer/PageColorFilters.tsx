import { DUOTONE_SCHEMES, LUMINANCE_MATRIX, duotoneTables, pageColorFilterId } from "@/shared/lib/pageColors";

export function PageColorFilters() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <defs>
        {DUOTONE_SCHEMES.map((scheme) => {
          const tables = duotoneTables(scheme);
          return (
            <filter key={scheme} id={pageColorFilterId(scheme)} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={LUMINANCE_MATRIX} />
              <feComponentTransfer>
                <feFuncR type="table" tableValues={tables.r} />
                <feFuncG type="table" tableValues={tables.g} />
                <feFuncB type="table" tableValues={tables.b} />
              </feComponentTransfer>
            </filter>
          );
        })}
      </defs>
    </svg>
  );
}
