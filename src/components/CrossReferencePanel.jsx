import { XREF_TAG_COLORS } from '../lib/constants';

export default function CrossReferencePanel({ crossRefs, onSelectRef }) {
  if (!crossRefs || crossRefs.length === 0) {
    return (
      <p className="text-[#4a5a6a] font-sans text-sm text-center py-10 italic">
        Cross-references appear here after a verse is displayed.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {crossRefs.map((ref, i) => (
        <div key={i} onClick={() => onSelectRef(ref)}
          className="bg-[#0d1b2a] border border-[#1e3050] hover:border-[#d4af37]/40 rounded-xl p-4 cursor-pointer transition-colors group">
          <div className="flex items-start justify-between gap-3 mb-2">
            <span className="text-[#d4af37] font-sans font-semibold text-sm group-hover:underline">
              {ref.reference}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-sans shrink-0 ${XREF_TAG_COLORS[ref.tag] ?? 'bg-gray-900 text-gray-300 border-gray-700'}`}>
              {ref.tag}
            </span>
          </div>
          {ref.text && (
            <p className="text-[#c8b89a] font-serif text-sm mb-2 line-clamp-2">"{ref.text}"</p>
          )}
          <p className="text-[#5a6a7a] font-sans text-xs">{ref.reason}</p>
        </div>
      ))}
    </div>
  );
}
