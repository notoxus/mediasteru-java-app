package com.mediasteru.view;

import java.io.File;

import javax.swing.JFileChooser;

public class FolderSelector {
	public static String chooseSaveDirectory() {
		JFileChooser chooser = new JFileChooser();

		chooser.setCurrentDirectory(new File(System.getProperty("user.home") + File.separator + "Downloads"));

		chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);

		int result = chooser.showDialog(null, "Choose location");

		if (result == JFileChooser.APPROVE_OPTION) {
			return chooser.getSelectedFile().getAbsolutePath();
		} else {
			System.out.println("Haven't chose directory yet, Downloads is default save directory.");
			return System.getProperty("user.home") + File.separator + "Downloads";
		}
	}
}