import React from 'react';
import PropTypes from 'prop-types';
import LayoutUtils from '../../layout/LayoutUtils';

import './WidgetPanelTooltip.scss';
import { GLPropTypes } from '../../include/prop-types';

const WidgetPanelTooltip = props => {
  const { widgetType, widgetName, glContainer, description } = props;
  const panelTitle = LayoutUtils.getTitleFromContainer(glContainer);

  return (
    <div className="tab-tooltip-container">
      <div className="row">
        <span className="tab-tooltip-title">
          <b>{widgetType} Name </b>
        </span>
        <span className="tab-tooltip-name">{widgetName}</span>
      </div>
      {widgetName !== panelTitle && (
        <div className="row">
          <span className="tab-tooltip-title">
            <b>Display Name</b>
          </span>
          <span className="tab-tooltip-name">{panelTitle}</span>
        </div>
      )}
      {description && (
        <div className="row">
          <span className="tab-tooltip-description">{description}</span>
        </div>
      )}
    </div>
  );
};

WidgetPanelTooltip.propTypes = {
  glContainer: GLPropTypes.Container.isRequired,
  widgetType: PropTypes.string,
  widgetName: PropTypes.string,
  description: PropTypes.string,
};

WidgetPanelTooltip.defaultProps = {
  widgetType: '',
  widgetName: '',
  description: null,
};

export default WidgetPanelTooltip;
