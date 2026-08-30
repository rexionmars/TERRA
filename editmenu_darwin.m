#import <Foundation/Foundation.h>

/*
 Keeps AppKit from adding its own items to the Edit menu.

 The Edit menu here is Wails': Undo, Redo, Cut, Copy, Paste, Paste and Match
 Style, Delete, Select All. AppKit appends four more to any Edit menu it finds
 -- Speech, AutoFill, Start Dictation and Emoji & Symbols -- and two of those
 can be declined. Neither belongs in an application whose only text fields are
 an area's name and a search box.

 THE MENU IS NOT REMOVED, and cannot be. Command-C, Command-V and Command-A in a
 WKWebView are delivered through the responder chain, which reaches the web view
 only because menu items carrying those key equivalents exist. An application
 with no Edit menu is an application where copy and paste stop working inside
 its own inputs.

 registerDefaults, not setObject:forKey:. Registering places the values in the
 defaults' registration domain, which is consulted when nothing else answers and
 is discarded when the process ends. Writing them would put two keys in the
 reader's own preferences and leave them there after the application is gone,
 for a choice that is this application's rather than theirs.

 Both keys are documented AppKit behaviour and public.
 */
void TerraDisableAutoEditMenuItems(void) {
    [[NSUserDefaults standardUserDefaults] registerDefaults:@{
        // "Start Dictation…"
        @"NSDisabledDictationMenuItem" : @YES,
        // "Emoji & Symbols"
        @"NSDisabledCharacterPaletteMenuItem" : @YES,
    }];
}
