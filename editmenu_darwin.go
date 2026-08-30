//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation
void TerraDisableAutoEditMenuItems(void);
*/
import "C"

/*
trimEditMenu declines the two Edit-menu items AppKit adds on its own.

Called before wails.Run, because the menu is built during it and a default
registered afterwards is registered too late. See editmenu_darwin.m for which
items these are, why the menu itself has to stay, and why the values are
registered rather than written.
*/
func trimEditMenu() {
	C.TerraDisableAutoEditMenuItems()
}
