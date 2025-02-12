import { KeyHandler } from '@deephaven/grid';
import { IrisGrid } from '../IrisGrid';
import IrisGridShortcuts from '../IrisGridShortcuts';

class ClearFilterKeyHandler extends KeyHandler {
  private irisGrid: IrisGrid;

  constructor(irisGrid: IrisGrid) {
    super();

    this.irisGrid = irisGrid;
  }

  onDown(e: KeyboardEvent): boolean {
    if (IrisGridShortcuts.TABLE.CLEAR_FILTERS.matchesEvent(e)) {
      this.irisGrid.clearAllFilters();
      return true;
    }
    return false;
  }
}

export default ClearFilterKeyHandler;
