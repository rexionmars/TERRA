//go:build !darwin

package main

/*
trimEditMenu does nothing off macOS.

The items it declines are AppKit's, added to any Edit menu it finds. No other
platform's menu grows on its own, so there is nothing to decline -- and a build
tag says that, where a runtime check would read as though the call might do
something.
*/
func trimEditMenu() {}
