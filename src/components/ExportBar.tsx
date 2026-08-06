interface Props {
  canExport: boolean;
  canExportNetlist: boolean;
  boardName: string;
  onSetBoardName: (name: string) => void;
  onExport: () => void;
  onExportNetlist: () => void;
  onViewSchematic: () => void;
  excludeImages: boolean;
  onSetExcludeImages: (exclude: boolean) => void;
}

export function ExportBar({
  canExport,
  canExportNetlist,
  boardName,
  onSetBoardName,
  onExport,
  onExportNetlist,
  onViewSchematic,
  excludeImages,
  onSetExcludeImages,
}: Props) {
  return (
    <div className="export-bar">
      <input
        type="text"
        placeholder="Board name"
        value={boardName}
        onChange={(e) => onSetBoardName(e.target.value)}
      />
      <label className="export-bar-checkbox">
        <input
          type="checkbox"
          checked={excludeImages}
          onChange={(e) => onSetExcludeImages(e.target.checked)}
        />
        Exclude photos
      </label>
      <button type="button" disabled={!canExport || !boardName.trim()} onClick={onExport}>
        Export SVG
      </button>
      <button type="button" disabled={!canExportNetlist} onClick={onExportNetlist}>
        Export netlist
      </button>
      <button type="button" disabled={!canExportNetlist} onClick={onViewSchematic}>
        View schematic
      </button>
      {!canExport && (
        <span className="export-hint">Upload both front and back images to export.</span>
      )}
      {canExport && !canExportNetlist && (
        <span className="export-hint">Group 2+ pads into a component to export a netlist.</span>
      )}
    </div>
  );
}
