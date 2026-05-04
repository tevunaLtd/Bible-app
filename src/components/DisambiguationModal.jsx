import { formatReference } from '../lib/bibleApi';

export default function DisambiguationModal({ item, onAccept, onDismiss }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a2a3a] border border-[#d4af37]/25 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <p className="text-[#d4af37] font-sans font-semibold text-xs uppercase tracking-widest mb-1">
          Did you mean?
        </p>
        <p className="text-[#f5ead6] text-xl font-serif mb-1">{formatReference(item)}</p>
        <p className="text-[#8a8a8a] font-sans text-sm mb-3">
          Detected from: <span className="text-[#c8b89a] italic">"{item.raw}"</span>
        </p>
        <p className="text-[#5a6a7a] font-sans text-xs mb-5">
          Confidence: {Math.round(item.confidence * 100)}%
        </p>
        <div className="flex gap-3">
          <button onClick={() => onAccept(item)}
            className="flex-1 bg-[#d4af37] hover:bg-[#c4a030] text-[#0d1b2a] font-sans font-semibold py-2 rounded-lg text-sm transition-colors">
            Yes, show it
          </button>
          <button onClick={onDismiss}
            className="flex-1 bg-[#0d1b2a] hover:bg-[#162230] text-[#8a8a8a] border border-[#243444] py-2 rounded-lg font-sans text-sm transition-colors">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
