import React, { Component, ErrorInfo } from 'react';
import { connect, ConnectedProps } from 'react-redux';
import shortid from 'shortid';
import type GoldenLayout from '@deephaven/golden-layout';
import memoize from 'memoize-one';
import { CSSTransition } from 'react-transition-group';
import { ThemeExport } from '@deephaven/components';
import { DateUtils, TableUtils } from '@deephaven/iris-grid';
import { DateTimeColumnFormatter } from '@deephaven/iris-grid/dist/formatters';
import Log from '@deephaven/log';
import {
  getActiveTool,
  getTimeZone,
  getIsolatedLinkerPanelIdForDashboard,
  getLinksForDashboard,
  setActiveTool as setActiveToolAction,
  setDashboardLinks as setDashboardLinksAction,
  addDashboardLinks as addDashboardLinksAction,
  deleteDashboardLinks as deleteDashboardLinksAction,
  setDashboardIsolatedLinkerPanelId as setDashboardIsolatedLinkerPanelIdAction,
  setDashboardColumnSelectionValidator as setDashboardColumnSelectionValidatorAction,
} from '@deephaven/redux';
import ToolType from '../../tools/ToolType';
import {
  ChartEvent,
  IrisGridEvent,
  PanelEvent,
  InputFilterEvent,
} from '../events';
import LayoutUtils from '../../layout/LayoutUtils';
import LinkerOverlayContent from './LinkerOverlayContent';
import LinkerUtils, { Link, LinkColumn, LinkType } from './LinkerUtils';
import { PanelManager } from '../panels';

const log = Log.module('Linker');

export type PanelProps = {
  glContainer: GoldenLayout.Container;
  glEventHub: GoldenLayout.EventEmitter;
};

export type Panel = Component<PanelProps>;

export type LinkFilterMapValue<T = unknown> = {
  columnType: string;
  text: string;
  value: T;
};

export type LinkFilterMap<T = unknown> = Map<string, LinkFilterMapValue<T>>;

export type LinkDataMapValue = {
  type: string;
  text: string;
  value: string;
};

export type LinkDataMap = Record<string, LinkDataMapValue>;

export type LinkablePanel = Panel & {
  setFilterMap: (filterMap: LinkFilterMap) => void;
  unsetFilterValue: () => void;
};

export function isLinkablePanel(panel: Panel): panel is LinkablePanel {
  const p = panel as LinkablePanel;
  return (
    typeof p.setFilterMap === 'function' &&
    typeof p.unsetFilterValue === 'function'
  );
}

interface StateProps {
  activeTool: string;
  isolatedLinkerPanelId?: string;
  links: Link[];
  timeZone: string;
}

interface OwnProps {
  layout: GoldenLayout;
  panelManager: PanelManager;
  localDashboardId: string;
}

const mapState = (state: LinkerState, ownProps: OwnProps): StateProps => ({
  activeTool: getActiveTool(state),
  isolatedLinkerPanelId: getIsolatedLinkerPanelIdForDashboard(
    state,
    ownProps.localDashboardId
  ),
  links: getLinksForDashboard(state, ownProps.localDashboardId),
  timeZone: getTimeZone(state),
});

type DispatchProps = {
  setActiveTool: (activeTool: string) => void;
  setDashboardLinks: (dashboardId: string, links: Link[]) => void;
  addDashboardLinks: (dashboardId: string, links: Link[]) => void;
  deleteDashboardLinks: (dashboardId: string, linkIds: string[]) => void;
  setDashboardIsolatedLinkerPanelId: (
    dashboardId: string,
    panelId: string | null
  ) => void;
  setDashboardColumnSelectionValidator: (
    dashboardId: string,
    columnValidator: ((panel: Panel, column?: LinkColumn) => boolean) | null
  ) => void;
};

const connector = connect<StateProps, DispatchProps, OwnProps>(mapState, {
  setActiveTool: setActiveToolAction,
  setDashboardLinks: setDashboardLinksAction,
  addDashboardLinks: addDashboardLinksAction,
  deleteDashboardLinks: deleteDashboardLinksAction,
  setDashboardIsolatedLinkerPanelId: setDashboardIsolatedLinkerPanelIdAction,
  setDashboardColumnSelectionValidator: setDashboardColumnSelectionValidatorAction,
});

export type LinkerProps = OwnProps & ConnectedProps<typeof connector>;

export type LinkerState = {
  linkInProgress?: Link;
};

class Linker extends Component<LinkerProps, LinkerState> {
  constructor(props: LinkerProps) {
    super(props);

    this.handleCancel = this.handleCancel.bind(this);
    this.handleDone = this.handleDone.bind(this);
    this.handlePanelCloned = this.handlePanelCloned.bind(this);
    this.handleFilterColumnSelect = this.handleFilterColumnSelect.bind(this);
    this.handleColumnsChanged = this.handleColumnsChanged.bind(this);
    this.handlePanelClosed = this.handlePanelClosed.bind(this);
    this.handleLayoutStateChanged = this.handleLayoutStateChanged.bind(this);
    this.handleAllLinksDeleted = this.handleAllLinksDeleted.bind(this);
    this.handleLinkDeleted = this.handleLinkDeleted.bind(this);
    this.handleChartColumnSelect = this.handleChartColumnSelect.bind(this);
    this.handleGridColumnSelect = this.handleGridColumnSelect.bind(this);
    this.handleUpdateValues = this.handleUpdateValues.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleExited = this.handleExited.bind(this);
    this.isColumnSelectionValid = this.isColumnSelectionValid.bind(this);

    this.state = { linkInProgress: undefined };
  }

  componentDidMount(): void {
    const { layout } = this.props;
    this.startListening(layout);
    this.updateSelectionValidators();
  }

  componentDidUpdate(prevProps: LinkerProps): void {
    const { activeTool, layout } = this.props;
    if (layout !== prevProps.layout) {
      this.stopListening(prevProps.layout);
      this.startListening(layout);
    }
    if (activeTool !== prevProps.activeTool) {
      this.updateSelectionValidators();
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('componentDidCatch', error, info);
  }

  componentWillUnmount(): void {
    const { layout } = this.props;
    this.stopListening(layout);
  }

  startListening(layout: GoldenLayout): void {
    layout.on('stateChanged', this.handleLayoutStateChanged);

    const { eventHub } = layout;
    eventHub.on(IrisGridEvent.COLUMN_SELECTED, this.handleGridColumnSelect);
    eventHub.on(IrisGridEvent.DATA_SELECTED, this.handleUpdateValues);
    eventHub.on(IrisGridEvent.STATE_CHANGED, this.handleStateChange);
    eventHub.on(ChartEvent.COLUMN_SELECTED, this.handleChartColumnSelect);
    eventHub.on(PanelEvent.CLONED, this.handlePanelCloned);
    eventHub.on(
      InputFilterEvent.COLUMN_SELECTED,
      this.handleFilterColumnSelect
    );
    eventHub.on(InputFilterEvent.COLUMNS_CHANGED, this.handleColumnsChanged);
    eventHub.on(PanelEvent.CLOSED, this.handlePanelClosed);
  }

  stopListening(layout: GoldenLayout): void {
    layout.off('stateChanged', this.handleLayoutStateChanged);

    const { eventHub } = layout;
    eventHub.off(IrisGridEvent.COLUMN_SELECTED, this.handleGridColumnSelect);
    eventHub.off(IrisGridEvent.DATA_SELECTED, this.handleUpdateValues);
    eventHub.off(IrisGridEvent.STATE_CHANGED, this.handleStateChange);
    eventHub.off(ChartEvent.COLUMN_SELECTED, this.handleChartColumnSelect);
    eventHub.off(PanelEvent.CLONED, this.handlePanelCloned);
    eventHub.off(
      InputFilterEvent.COLUMN_SELECTED,
      this.handleFilterColumnSelect
    );
    eventHub.off(InputFilterEvent.COLUMNS_CHANGED, this.handleColumnsChanged);
    eventHub.off(PanelEvent.CLOSED, this.handlePanelClosed);
  }

  handleCancel() {
    const { linkInProgress } = this.state;
    if (linkInProgress == null) {
      const { setActiveTool } = this.props;
      setActiveTool(ToolType.DEFAULT);
    }
    this.setState({ linkInProgress: undefined });
  }

  handleDone() {
    const { setActiveTool } = this.props;
    setActiveTool(ToolType.DEFAULT);
    this.setState({ linkInProgress: undefined });
  }

  handleChartColumnSelect(panel: Panel, column: LinkColumn): void {
    this.columnSelected(panel, column, true);
  }

  handleFilterColumnSelect(panel: Panel, column: LinkColumn): void {
    log.debug('handleFilterColumnSelect', this.isOverlayShown());
    const {
      links,
      localDashboardId,
      setActiveTool,
      setDashboardIsolatedLinkerPanelId,
    } = this.props;

    const panelId = LayoutUtils.getIdFromPanel(panel);
    const panelLinks = links.filter(
      link => link.start?.panelId === panelId || link.end?.panelId === panelId
    );

    if (!this.isOverlayShown() && panelId != null) {
      // Initial click on the filter source button with linker inactive
      // Show linker in isolated mode for panel
      setActiveTool(ToolType.LINKER);
      setDashboardIsolatedLinkerPanelId(localDashboardId, panelId);

      if (panelLinks.length === 0) {
        // Source not linked - start new link in isolated linker mode
        // Need to pass panelId for overrideIsolatedLinkerPanelId
        // as redux prop update at this point not yet propagated
        this.columnSelected(panel, column, true, panelId);
      }
      return;
    }

    // Filter source clicked with linker active
    this.columnSelected(panel, column, true);
  }

  handleColumnsChanged(panel: Panel, columns: LinkColumn[]): void {
    log.debug('handleColumnsChanged', panel, columns);
    const { links } = this.props;
    const panelId = LayoutUtils.getIdFromPanel(panel);
    if (panelId == null) {
      log.error('Invalid panelId', panel);
      return;
    }
    // Delete links that start or end on non-existent column in the updated panel
    const linksToDelete = links.filter(
      ({ start, end }) =>
        (start.panelId === panelId &&
          LinkerUtils.findColumn(columns, start) == null) ||
        (end != null &&
          end.panelId === panelId &&
          LinkerUtils.findColumn(columns, end) == null)
    );
    this.deleteLinks(linksToDelete);
  }

  handleGridColumnSelect(panel: Panel, column: LinkColumn): void {
    this.columnSelected(panel, column);
  }

  /**
   * Track a column selection and build the link from it.
   * @param panel The panel component that is the source for the column selection
   * @param column The column that was selected
   * @param isAlwaysEndPoint True if the selection is always the end point, even if it's the first column selected. Defaults to false.
   * @param overrideIsolatedLinkerPanelId isolatedLinkerPanelId to use when method is called before prop changes propagate
   */
  columnSelected(
    panel: Panel,
    column: LinkColumn,
    isAlwaysEndPoint = false,
    overrideIsolatedLinkerPanelId?: string
  ): void {
    if (overrideIsolatedLinkerPanelId == null && !this.isOverlayShown()) {
      return;
    }
    const { isolatedLinkerPanelId } = this.props;
    const { linkInProgress } = this.state;
    const panelId = LayoutUtils.getIdFromPanel(panel);
    if (panelId == null) {
      return;
    }
    const panelComponent = LayoutUtils.getComponentNameFromPanel(panel);
    const { name: columnName, type: columnType } = column;
    if (linkInProgress == null || linkInProgress.start == null) {
      const newLink: Link = {
        id: shortid.generate(),
        start: {
          panelId,
          panelComponent,
          columnName,
          columnType,
        },
        // Link starts with type Invalid as linking a source to itself is not allowed
        type: 'invalid',
        isReversed: isAlwaysEndPoint,
      };

      log.debug('starting link', newLink);

      this.setState({ linkInProgress: newLink });
    } else {
      const { start, id, isReversed } = linkInProgress;
      const end = {
        panelId,
        panelComponent,
        columnName,
        columnType,
      };

      const type = LinkerUtils.getLinkType(
        isReversed ? end : start,
        isReversed ? start : end,
        overrideIsolatedLinkerPanelId ?? isolatedLinkerPanelId
      );

      switch (type) {
        case 'invalid':
          log.debug('Ignore invalid link connection', linkInProgress, end);
          return;
        case 'filterSource': {
          // filterSource links have a limit of 1 link per target
          // New link validation passed, delete existing links before adding the new one
          const { links } = this.props;
          const existingLinkPanelId = isReversed ? start.panelId : end.panelId;
          // In cases with multiple targets per panel (i.e. chart filters)
          // links would have to be filtered by panelId and columnName and columnType
          const linksToDelete = links.filter(
            ({ end: panelLinkEnd }) =>
              panelLinkEnd?.panelId === existingLinkPanelId
          );
          this.deleteLinks(linksToDelete);
          break;
        }
        case 'tableLink':
          // No-op
          break;
      }

      // Create a completed link from link in progress
      const newLink = {
        start: isReversed ? end : start,
        end: isReversed ? start : end,
        id,
        type,
      };
      log.info('creating link', newLink);

      this.setState({ linkInProgress: undefined }, () => {
        // Adding link after updating state
        // otherwise both new link and linkInProgress could be rendered at the same time
        // resulting in "multiple children with same key" error
        this.addLinks([newLink]);
      });
    }
  }

  unsetFilterValueForLink(link: Link): void {
    const { panelManager } = this.props;
    if (link.end) {
      const { end } = link;
      const { panelId, columnName, columnType } = end;
      const endPanel = panelManager.getOpenedPanelById(panelId);
      if (endPanel && endPanel.unsetFilterValue) {
        endPanel.unsetFilterValue(columnName, columnType);
      } else if (!endPanel) {
        log.debug(
          'endPanel no longer exists, ignoring unsetFilterValue',
          panelId
        );
      } else {
        log.debug('endPanel.unsetFilterValue not implemented', endPanel);
      }
    }
  }

  /**
   * Set filters for a given panel ID
   * @param panelId ID of panel to set filters on
   * @param filterMap Map of column name to column type, text, and value
   */
  setPanelFilterMap(panelId: string, filterMap: LinkFilterMap) {
    log.debug('Set filter data for panel:', panelId, filterMap);
    const { panelManager } = this.props;
    const panel = panelManager.getOpenedPanelById(panelId);
    if (isLinkablePanel(panel)) {
      panel.setFilterMap(filterMap);
    } else if (!panel) {
      log.debug('panel no longer exists, ignoring setFilterMap', panelId);
    } else {
      log.debug('panel.setFilterMap not implemented', panelId, panel);
    }
  }

  addLinks(links: Link[]) {
    const { addDashboardLinks, localDashboardId } = this.props;
    addDashboardLinks(localDashboardId, links);
  }

  deleteLinks(links: Link[], clearAll = false) {
    const { localDashboardId } = this.props;
    links.forEach(link => this.unsetFilterValueForLink(link));
    if (clearAll) {
      const { setDashboardLinks } = this.props;
      setDashboardLinks(localDashboardId, []);
    } else if (links.length > 0) {
      const { deleteDashboardLinks } = this.props;
      deleteDashboardLinks(
        localDashboardId,
        links.map(({ id }) => id)
      );
    }
  }

  handleAllLinksDeleted(): void {
    const { links, isolatedLinkerPanelId } = this.props;
    if (isolatedLinkerPanelId == null) {
      this.deleteLinks(links, true);
    } else {
      const isolatedLinks = links.filter(
        link =>
          link?.start?.panelId === isolatedLinkerPanelId ||
          link?.end?.panelId === isolatedLinkerPanelId
      );
      this.deleteLinks(isolatedLinks);
    }
    this.setState({ linkInProgress: undefined });
  }

  handleLinkDeleted(linkId: string) {
    const { links } = this.props;
    const link = links.find(l => l.id === linkId);
    if (link) {
      this.deleteLinks([link]);
    } else {
      log.error('Unable to find link to delete', linkId);
    }
  }

  handleUpdateValues(panel: Panel, dataMap: LinkDataMap) {
    const panelId = LayoutUtils.getIdFromPanel(panel);
    const { links, timeZone } = this.props;
    // Map of panel ID to filterMap
    const panelFilterMap = new Map();
    // Instead of setting filters one by one for each link,
    // combine them so they could be set in a single call per target panel
    for (let i = 0; i < links.length; i += 1) {
      const { start, end } = links[i];
      if (start.panelId === panelId && end != null) {
        const { panelId: endPanelId, columnName, columnType } = end;
        // Map of column name to column type and filter value
        const filterMap = panelFilterMap.has(endPanelId)
          ? panelFilterMap.get(endPanelId)
          : new Map();
        const { value } = dataMap[start.columnName];
        let text = `${value}`;
        if (TableUtils.isDateType(columnType)) {
          const dateFilterFormatter = new DateTimeColumnFormatter({
            timeZone,
            showTimeZone: false,
            showTSeparator: true,
            defaultDateTimeFormatString: DateUtils.FULL_DATE_FORMAT,
          });
          text = dateFilterFormatter.format(value);
        }
        filterMap.set(columnName, {
          columnType,
          text,
          value,
        });
        panelFilterMap.set(endPanelId, filterMap);
      }
    }

    // Apply combined filters to all target panels
    panelFilterMap.forEach((filterMap, endPanelId) => {
      this.setPanelFilterMap(endPanelId, filterMap);
    });
  }

  handlePanelCloned(panel: Panel, cloneConfig: { id: string }) {
    const { links } = this.props;
    const panelId = LayoutUtils.getIdFromPanel(panel);
    const cloneId = cloneConfig.id;
    if (panelId != null) {
      const linksToAdd = LinkerUtils.cloneLinksForPanel(
        links,
        panelId,
        cloneId
      );
      this.addLinks(linksToAdd);
    }
  }

  handlePanelClosed(panelId: string): void {
    // Delete links on PanelEvent.CLOSED instead of UNMOUNT
    // because the panels can get unmounted on errors and we want to keep the links if that happens
    log.debug(`Panel ${panelId} closed, deleting links.`);
    this.deleteLinksForPanelId(panelId);
  }

  handleLayoutStateChanged() {
    this.forceUpdate();
  }

  handleStateChange() {
    this.forceUpdate();
  }

  handleExited() {
    // Has to be done after linker exit animation to avoid flashing non-isolated links
    const { localDashboardId, setDashboardIsolatedLinkerPanelId } = this.props;
    setDashboardIsolatedLinkerPanelId(localDashboardId, null);
  }

  /**
   * Delete all links for a provided panel ID. Needs to be done whenever a panel is closed or unmounted.
   * @param panelId The panel ID to delete links for
   */
  deleteLinksForPanelId(panelId: string) {
    const { links } = this.props;
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      const { start, end, id } = link;
      if (start.panelId === panelId || end?.panelId === panelId) {
        this.handleLinkDeleted(id);
      }
    }
  }

  getCachedLinks = memoize((links, linkInProgress, isolateForPanelId) => {
    const combinedLinks = [...links];

    if (linkInProgress && linkInProgress.start) {
      combinedLinks.push(linkInProgress);
    }

    if (isolateForPanelId !== null) {
      return combinedLinks.filter(
        link =>
          link?.start?.panelId === isolateForPanelId ||
          link?.end?.panelId === isolateForPanelId ||
          link?.end == null
      );
    }
    // Show all links in regular linker mode -- both isolated and not
    return combinedLinks;
  });

  isOverlayShown() {
    const { activeTool } = this.props;
    return activeTool === ToolType.LINKER;
  }

  updateSelectionValidators() {
    const {
      activeTool,
      setDashboardColumnSelectionValidator,
      localDashboardId,
    } = this.props;
    switch (activeTool) {
      case ToolType.LINKER:
        setDashboardColumnSelectionValidator(
          localDashboardId,
          this.isColumnSelectionValid
        );
        break;
      default:
        setDashboardColumnSelectionValidator(localDashboardId, null);
        break;
    }
  }

  updateLinkInProgressType(linkInProgress: Link, type: LinkType = 'invalid') {
    this.setState({
      linkInProgress: {
        ...linkInProgress,
        type,
      },
    });
  }

  isColumnSelectionValid(panel: Panel, tableColumn?: LinkColumn): boolean {
    const { linkInProgress } = this.state;
    const { isolatedLinkerPanelId } = this.props;

    // Link not started yet - no need to update type
    if (linkInProgress?.start == null) {
      return true;
    }

    if (tableColumn == null) {
      // Link started, end point is not a valid target
      this.updateLinkInProgressType(linkInProgress);
      return false;
    }

    const { isReversed, start } = linkInProgress;
    const panelId = LayoutUtils.getIdFromPanel(panel);
    if (panelId == null) {
      return false;
    }

    const end = {
      panelId,
      panelComponent: LayoutUtils.getComponentNameFromPanel(panel),
      columnName: tableColumn.name,
      columnType: tableColumn.type,
    };

    const type = isReversed
      ? LinkerUtils.getLinkType(end, start, isolatedLinkerPanelId)
      : LinkerUtils.getLinkType(start, end, isolatedLinkerPanelId);

    this.updateLinkInProgressType(linkInProgress, type);

    return type !== 'invalid';
  }

  render() {
    const { links, isolatedLinkerPanelId, panelManager } = this.props;
    const { linkInProgress } = this.state;

    const isLinkOverlayShown = this.isOverlayShown();
    const disabled = linkInProgress != null && linkInProgress.start != null;
    const linkerOverlayMessage =
      isolatedLinkerPanelId === null
        ? 'Click a column source, then click a column target to create a filter link. Remove a filter link by clicking again to erase. Click done when finished.'
        : 'Create a link between the source column button and a table column by clicking on one, then the other. Remove the link by clicking it directly. Click done when finished.';
    return (
      <>
        <CSSTransition
          in={isLinkOverlayShown}
          timeout={ThemeExport.transitionMs}
          classNames="fade"
          mountOnEnter
          unmountOnExit
          onExited={this.handleExited}
        >
          <LinkerOverlayContent
            disabled={disabled}
            panelManager={panelManager}
            links={this.getCachedLinks(
              links,
              linkInProgress,
              isolatedLinkerPanelId
            )}
            messageText={linkerOverlayMessage}
            onLinkDeleted={this.handleLinkDeleted}
            onAllLinksDeleted={this.handleAllLinksDeleted}
            onDone={this.handleDone}
            onCancel={this.handleCancel}
          />
        </CSSTransition>
      </>
    );
  }
}

export default connector(Linker);
