interface Props {
  canExport: boolean;
  boardName: string;
  onSetBoardName: (name: string) => void;
  onExport: () => void;
}

export function ExportBar({ canExport, boardName, onSetBoardName, onExport }: Props) {
  return (
    <div className="export-bar">
      <input
        type="text"
        placeholder="Board name"
        value={boardName}
        onChange={(e) => onSetBoardName(e.target.value)}
      />
      <button type="button" disabled={!canExport || !boardName.trim()} onClick={onExport}>
        Export SVG
      </button>
      {!canExport && (
        <span className="export-hint">Upload both front and back images to export.</span>
      )}
    </div>
  );
}
