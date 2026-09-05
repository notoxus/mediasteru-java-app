package com.mediasteru.view;

import java.awt.Component;

import javax.swing.JProgressBar;
import javax.swing.JTable;
import javax.swing.table.TableCellRenderer;

public class ProgressRenderer extends JProgressBar implements TableCellRenderer {
	private static final long serialVersionUID = 1L;

	public ProgressRenderer() {
		super(0, 100);
		setStringPainted(true); 
	}

	@Override
	public Component getTableCellRendererComponent(JTable table, Object value, boolean isSelected, boolean hasFocus, int row, int column) {
		if (value != null) {
			String strValue = value.toString();
			setString(strValue); 
			try {
				String percentStr = strValue.split("%")[0].trim();
				setValue((int) Double.parseDouble(percentStr));
			} catch (Exception e) {
				setValue(0);
			}
		}
		return this;
	}
}
