/**
 * humaninput.js
 * Copyright (c) 2016, Dan McDougall
 *
 *
 */

(function() {
"use strict";

// Sandbox-side variables and shortcuts
var window = this,
    l, // Will be replaced with a translate() func for i18n
    MACOS = (navigator.userAgent.indexOf('Mac OS X') != -1),
    KEYSUPPORT = false, // If the browser supports KeyboardEvent.key
    defaultEvents = ['keydown', 'keypress', 'keyup', 'click', 'dblclick', 'wheel', 'contextmenu', 'compositionstart', 'compositionupdate', 'compositionend', 'cut', 'copy', 'paste', 'select'],
    pointerEvents = ['pointerdown', 'pointerup'], // Better than mouse/touch!
    mouseTouchEvents = ['mousedown', 'mouseup', 'touchstart', 'touchend'],
    finishedKeyCombo = false,
    downState = [],
    // Internal utility functions
    noop = function(a) { return a },
    toString = Object.prototype.toString,
    getNode = function(nodeOrSelector) {
        if (typeof nodeOrSelector === 'string') {
            var result = document.querySelector(nodeOrSelector);
            return result;
        }
        return nodeOrSelector;
    },
    normEvents = function(events) { // Converts events to an array if it's a single event (a string)
        if (_.isString(events)) { events = [events]; }
        return events;
    },
    handlePreventDefault = function(e, results) { // Just a DRY method
        // If any of the 'results' are false call preventDefault()
        if (results.indexOf(false) != -1) {
            e.preventDefault();
        }
    },
    cloneArray = function(arr) {
        var copy, i;
        if(_.isArray(arr)) {
            copy = arr.slice(0);
            for(i = 0; i < copy.length; i++) {
                copy[i] = cloneArray(copy[i]);
            }
            return copy;
        } else {
            return arr;
        }
    },
    arrayCombinations = function(arr, separator) {
        var result = [], remaining, i, n;
        if (arr.length == 1) {
            return arr[0];
        } else {
            remaining = arrayCombinations(arr.slice(1), separator);
            for (i = 0; i < remaining.length; i++) {
                for (n = 0; n < arr[0].length; n++) {
                    result.push(arr[0][n] + separator + remaining[i]);
                }
            }
            return result;
        }
    },
    getCoord = function (e, c) {
        return /touch/.test(e.type) ? (e.originalEvent || e).changedTouches[0]['page' + c] : e['page' + c];
    },
    isUpper = function(str) { if (str == str.toUpperCase()) { return true; }},
    startsWith = function(substr, str) {return str != null && substr != null && str.indexOf(substr) == 0;},
    _ = _ || noop; // Internal underscore-like function (just the things we need)

// Setup a few functions borrowed from underscore.js...
['Function', 'String', 'Number'].forEach(function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
});
_.isArray = Array.isArray;
_.toArray = function(obj) {
    var i, array = [];
    for (i = obj.length >>> 0; i--;) { array[i] = obj[i]; }
    return array;
};
_.partial = function(func) {
    var args = _.toArray(arguments);
    args.shift(); // Remove 'func'
    return function() {
        return func.apply(this, args.concat(_.toArray(arguments)));
    };
};

// Check if the browser supports KeyboardEvent.key:
if (Object.keys(KeyboardEvent.prototype).indexOf('key') != -1) {
    KEYSUPPORT = true;
}

/* Mouse/Pointer/Touch TODO:

    * Normalize events to the new 'pointer' events: pointerover, pointerenter, pointerdown, pointermove, pointerup, pointercancel, pointerout, pointerleave, gotpointercapture, lostpointercapture
    * Function: Calculate the center between two points (necessary for detecting pinch/spread)
    * Function: Calculate angle between two points (necessary for detecting rotation)
    * Function: Calculate the scale of movement between two points ('pinch:0.2' 'spread:0.4')
    * Figure something out for drag & drop.
    * Make sure that gestures like swiping don't screw up mousedown/move.

*/


var HumanInput = function(elem, settings) {
    /**:HumanInput(elem, settings)

    A library for managing human input on the web.  Features:

        * Can manage keyboard shortcuts including sophisticated macros and modifiers.
        * Supports international keyboards, alternate keyboard layouts, and software keyboards (IME friendly).
        * Supports mouse events which can be combined with the keyboard for highly advanced user interfaces.
        * Includes a plugin architecture with plugins available for touch events and gamepads/joysticks!
        * Any key or button can be a modifier.  Even gamepad buttons and multi-finger touches!
        * Super easy to debug with a powerful built-in logger (but you can use your own too!) and event emulation/trigger capabilities.
        * Can be extended to support other forms of input.

    HumanInput uses the key names implemented in the DOM Level 3 KeyboardEvent standard:

    http://www.w3.org/TR/DOM-Level-3-Events-key/

    Settings
    --------
    listenEvents (events to listen on)
    translate (localization function)
    noKeyRepeat
    sequenceTimeout
    maxSequenceBuf
    uniqueNumpad
    swipeThreshold

    */
    if (!(this instanceof HumanInput)) { return new HumanInput(elem, settings); }
    var self = this, // Explicit is better than implicit
        xDown, yDown, recordedEvents, composing, noMouseEvents,
//         separator = /,\s*/,
        lastDownLength = 0;
    self.__version__ = "1.0.0";
    // NOTE: Most state-tracking variables are set inside HumanInput.init()

    // Constants
    self.OSKEYS = ['OS', 'OSLeft', 'OSRight'],
    self.CONTROLKEYS = ['Control', 'ControlLeft', 'ControlRight'],
    self.ALTKEYS = ['Alt', 'AltLeft', 'AltRight'],
    self.SHIFTKEYS = ['Shift', 'ShiftLeft', 'ShiftRight', '⇧'],
    self.ALLMODIFIERS = self.OSKEYS.concat(self.CONTROLKEYS, self.ALTKEYS, self.SHIFTKEYS),
    self.ControlKeyEvent = 'ctrl';
    self.ShiftKeyEvent = 'shift';
    self.AltKeyEvent = 'alt';
    self.OSKeyEvent = 'os';
    self.AltAltNames = ['option', '⌥'];
    self.AltOSNames = ['meta', 'win', '⌘', 'cmd', 'command'];

    // Apply our settings:
    settings = settings || {};
    self.l = l = settings.translate || noop;
    settings.listenEvents = settings.listenEvents || defaultEvents;
    settings.noKeyRepeat = settings.noKeyRepeat || true; // Disable key repeat by default
    settings.sequenceTimeout = settings.sequenceTimeout || 3000; // 3s default
    settings.maxSequenceBuf = settings.maxSequenceBuf || 12;
    settings.uniqueNumpad = settings.uniqueNumpad || false;
    settings.swipeThreshold = settings.swipeThreshold || 100; // 100px minimum to be considered a swipe
    self.settings = settings;
    self.elem = getNode(elem || window);
    self.log = new self.logger(settings.logLevel || 'INFO', '[HI]');

    // Internal functions and variables:
    self._resetKeyStates = function() {
        // This gets called after the sequenceTimeout to reset the state of all keys and modifiers
        // It saves us in the event that a user changes windows while a key is held down (e.g. command-tab)
        self.modifiers = {};
        self.seqBuffer = [];
        self.down = [];
        downState = [];
        lastDownLength = 0;
        finishedKeyCombo = false;
    };
    self._addDown = function(event, alt) {
        // Adds the given *event* to self.down and downState to ensure the two stay in sync in terms of how many items they hold.
        // If an *alt* event is given it will be stored in downState explicitly
        var index = self.down.indexOf(event);
        if (index == -1) {
            index = downState.indexOf(event);
        }
        if (index == -1 && alt) {
            index = downState.indexOf(alt);
        }
        if (index == -1) {
            self.down.push(event);
            if (alt) {
                downState.push(alt);
            } else {
                downState.push(event);
            }
        }
    };
    self._removeDown = function(event) {
        // Removes the given *event* from self.down and downState (if found); keeping the two in sync in terms of indexes
        var index = self.down.indexOf(event);
        if (index == -1) {
            // Event changed between 'down' and 'up' events
            index = downState.indexOf(event);
        }
        if (index == -1) { // Still no index?  Try one more thing: Upper case
            index = downState.indexOf(event.toUpperCase()); // Handles the situation where the user releases a key *after* a Shift key combo
        }
        if (index != -1) {
            self.down.splice(index, 1);
            downState.splice(index, 1);
        }
        lastDownLength = self.down.length;
    };
    self._resetSeqTimeout = function() {
        // Ensure that the seqBuffer doesn't get emptied (yet):
        clearTimeout(self.temp.seqTimer);
        self.temp.seqTimer = setTimeout(function() {
            self.log.debug(l('Resetting key states due to timeout'));
            self._resetKeyStates();
        }, self.settings.sequenceTimeout);
    };
    self._keyEvent = function(key) {
        // Given a *key* like 'ShiftLeft' returns the "official" key event or just the given *key* in lower case
        if (self.CONTROLKEYS.indexOf(key) != -1) {
            return self.ControlKeyEvent;
        } else if (self.ALTKEYS.indexOf(key) != -1) {
            return self.AltKeyEvent;
        } else if (self.SHIFTKEYS.indexOf(key) != -1) {
            return self.ShiftKeyEvent;
        } else if (self.OSKEYS.indexOf(key) != -1) {
            return self.OSKeyEvent;
        } else {
            return key.toLowerCase();
        }
    };
    self._seqCombinations = function(buffer, joinChar) {
        /**:HumanInput._seqCombinations(buffer[, joinChar])

        Returns all possible alternate name combinations of events (as an Array) for a given buffer (*buffer*) which must be an Array of Arrays in the form of::

            [['ControlLeft', 'c'], ['a']]

        The example above would be returned as an Array of strings that can be passed to :js:func:`HumanInput._seqSlicer` like so::

            ['controlleft-c a', 'ctrl-c a']

        The given *joinChar* will be used to join the characters for key combinations.

        .. note:: Events will always be emitted in lower case.  To use events with upper case letters use the 'shift' modifier (e.g. 'shift-a').  Shifted letters that are not upper case do not require the 'shift' modifier (e.g. '?').
        */
        joinChar = joinChar || '-';
        var replacement = cloneArray(buffer), out = [], temp = [], i, j;
        for (i=0; i < buffer.length; i++) {
            out.push(replacement[i].join(joinChar).toLowerCase());
        }
        out = [out.join(' ')];
        for (i=0; i < buffer.length; i++) {
            // Normalize names and make sure they're lower-case
            for (j=0; j < buffer[i].length; j++) {
                replacement[i][j] = [self._keyEvent(buffer[i][j])];
            }
        }
        for (i=0; i < replacement.length; i++) {
            temp.push(arrayCombinations(replacement[i], joinChar));
        }
        temp = temp.join(' ');
        if (temp != out[0]) { // Only if they're actually different
            out.push(temp);
        }
        return out;
    };
    self._downEvents = function() {
        // Returns all events that could represent the current state of ``self.down``.  e.g. ['shiftleft-a', 'shift-a'] but not ['shift', 'a']
        var i, events = [],
            skipPrecise,
            shiftKeyIndex = -1,
            shiftedKey,
            down = self.down.slice(0), // Make a copy because we're going to mess with it
            unshiftedDown = downState.slice(0);
        if (down.length) {
            if (down.length > 1) {
                // Before sorting, fire the precise key combo event
                if (self.modifiers.shift) {
                    for (i=0; i < down.length; i++) {
                        shiftKeyIndex = down[i].indexOf('Shift');
                        if (shiftKeyIndex != -1) { break; }
                    }
                }
                for (i=0; i < down.length; i++) {
                    if (down[i] != downState[i] && shiftKeyIndex != -1) {
                        // Key was shifted; use the un-shifted key for a user-friendly "precise" event...
                        shiftedKey = true;
                    }
                }
                if (shiftedKey) { // _keypress() wound up with a shifted key
                    if (down.length == 2) {
                        // We don't need to trigger a "precise" event since "shift-><key>" turns into just "<key>"
                        skipPrecise = true;
                    }
                    // Remove the 'shift' key so folks can use just "?" instead of "shift-/"
                    down.splice(shiftKeyIndex, 1);
                }
                if (!skipPrecise) {
                    events = events.concat(self._seqCombinations([down], '->'));
                    if (shiftedKey) {
                        events = events.concat(self._seqCombinations([unshiftedDown], '->'));
                    }
                }
            }
            self._sortEvents(down);
            // Make events for all alternate names (e.g. 'controlleft-a' and 'ctrl-a'):
            events = events.concat(self._seqCombinations([down]));
            if (shiftedKey) {
                self._sortEvents(unshiftedDown);
                events = events.concat(self._seqCombinations([unshiftedDown]));
            }
        }
        return events;
    };
    self._handleDownEvents = function() {
        var i, events = [],
            results = [],
            args = _.toArray(arguments);
        events = self._downEvents();
        for (i=0; i < events.length; i++) {
            results = results.concat(self.trigger.apply(self, [self.scope + events[i]].concat(args)));
        }
        return results;
    };
    self._handleSeqEvents = function() {
        // NOTE:  Only call this function when a button or key is released (i.e. when state changes to UP)
        var combos, i, results,
            seqEvents = '',
            down = self.down.slice(0);
        if (lastDownLength < down.length) { // User just finished a combo (e.g. ctrl-a)
            down = self._sortEvents(down);
            self.seqBuffer.push(down);
            if (self.seqBuffer.length > self.settings.maxSequenceBuf) {
                // Make sure it stays within the specified max
                self.seqBuffer.reverse();
                self.seqBuffer.pop();
                self.seqBuffer.reverse();
            }
            // Sort the sequence buffer to ensure consistent events
            for (i=0; i < self.seqBuffer.length; i++) {
                self.seqBuffer[i].sort(function(a, b) {
                    return b.length - a.length; // Sort by length to ensure single keys end up at the end
                });
            }
            if (self.seqBuffer.length > 1) {
                combos = self._seqCombinations(self.seqBuffer);
                combos.forEach(function(seq) {
                    seqEvents += self.scope + self._seqSlicer(seq) + ',';
                });
                seqEvents = seqEvents.slice(0, -1); // Remove trailing comma
                // Trigger the sequence buffer events
                results = self.trigger(seqEvents, self);
                if (results.length) {
                    self.seqBuffer = []; // Reset the sequence buffer on matched event
                }
            }
        }
        self._resetSeqTimeout();
    };
    self._normSpecial = function(location, key, code) {
        // Just a DRY function for keys that need some extra love
        if (code.indexOf('Left') != -1 || code.indexOf('Right') != -1) {
            // Use the left and right variants of the name as the 'key'
            key = code; // So modifiers can be more specific
        } else if (self.settings.uniqueNumpad && location == 3) {
            return 'numpad' + key; // Will be something like 'numpad5' or 'numpadenter'
        }
        if (startsWith('arrow', key.toLowerCase())) {
            key = key.substr(5); // Remove the 'arrow' part
        }
        return key;
    };
    self._setModifiers = function(code, bool) {
        // Set all modifiers matching *code* to *bool*
        if (self.ALLMODIFIERS.indexOf(code)) {
            if (self.SHIFTKEYS.indexOf(code) != -1) {
                self.modifiers.shift = bool;
            }
            if (self.CONTROLKEYS.indexOf(code) != -1) {
                self.modifiers.ctrl = bool;
            }
            if (self.ALTKEYS.indexOf(code) != -1) {
                self.modifiers.alt = bool;
                self.modifiers.option = bool;
                self.modifiers['⌥'] = bool;
            }
            if (self.OSKEYS.indexOf(code) != -1) {
                self.modifiers.meta = bool;
                self.modifiers.command = bool;
                self.modifiers.os = bool;
                self.modifiers['⌘'] = bool;
            }
            self.modifiers[code] = bool; // Required for differentiating left and right variants
        }
    };
    self._keydown = function(e) {
        // NOTE: e.which and e.keyCode will be incorrect for a *lot* of keys
        //       and basically always incorrect with alternate keyboard layouts
        //       which is why we replace self.down[<the key>] inside _keypress()
        //       when we can (for browsers that don't support KeyboardEvent.key).
        var results = [],
            keyCode = e.which || e.keyCode,
            location = e.location || 0,
// NOTE: Should I put e.code first below?  Hmmm.  Should we allow keyMaps to override the browser's native key name if it's available?
            code = self.keyMaps[location][keyCode] || self.keyMaps[0][keyCode] || e.code,
            key = e.key || code,
            notFiltered = self.filter(e);
        key = self._normSpecial(location, key, code);
//         self.log.debug('_keydown()', e, 'keyCode:', keyCode, 'key:', key, 'code:', code, 'notFiltered:', notFiltered);
        // Set modifiers and mark the key as down whether we're filtered or not:
        self._setModifiers(key, true);
        if (key == 'Compose') { // This indicates that the user is entering a composition
            composing = true;
            return;
        }
        if (downState.indexOf(key) == -1) {
            self._addDown(key, code);
        }
        // Don't let the sequence buffer reset if the user is active:
        self._resetSeqTimeout();
        if (notFiltered) {
            if (e.repeat && self.settings.noKeyRepeat) {
                e.preventDefault(); // Make sure keypress doesn't fire after this
                return false; // Don't do anything if key repeat is disabled
            }
            // This is in case someone wants just on('keydown'):
            results = self.trigger(self.scope + 'keydown', e, key, code);
            handlePreventDefault(e, results);
            if (self.down.length > 5) { // 6 or more keys down at once?  FACEPLANT!
                results = results.concat(self.trigger(self.scope + 'faceplant', e)); // ...or just key mashing :)
            }
            results = results.concat(self.trigger(self.scope + 'keydown:' + key.toLowerCase(), e, key, code));
/* NOTE: For browsers that support KeyboardEvent.key we can trigger the usual
         events inside _keydown() (which is faster) but other browsers require
         _keypress() be called first to fix localized/shifted keys.  So for those
         browser we call _handleDownEvents() inside _keyup(). */
            if (KEYSUPPORT) {
                results = results.concat(self._handleDownEvents(e));
            }
            handlePreventDefault(e, results);
        }
    };
// NOTE: Use of _keypress is only necessary until Safari supports KeyboardEvent.key!
    self._keypress = function(e) {
        // NOTE: keypress events don't always fire when modifiers are used!
        //       This means that such browsers may never get sequences like 'ctrl-?'
        self.log.debug('_keypress()', e);
        var charCode = e.charCode || e.which;
        var key = e.key || String.fromCharCode(charCode);
        if (!KEYSUPPORT && charCode > 47 && key.length) {
            // Replace the possibly-incorrect key with the correct one
            self.down.pop();
            self.down.push(key);
        }
    };
    self._keyup = function(e) {
        var results, keyCode = e.which || e.keyCode,
            location = e.location || 0,
// NOTE: Should I put e.code first below?  Hmmm.  Should we allow keyMaps to override the browser's native key name if it's available?
            code = self.keyMaps[location][keyCode] || self.keyMaps[0][keyCode] || e.code,
            key = e.key || code,
            notFiltered = self.filter(e);
        key = self._normSpecial(location, key, code);
        self.log.debug('_keyup()', e, 'self.down:', self.down, 'seqBuffer:', self.seqBuffer);
        if (!downState.length) { // Implies key states were reset or out-of-order somehow
            return; // Don't do anything since our state is invalid
        }
        if (composing) {
            composing = false;
            return;
        }
        if (notFiltered) {
            if (!KEYSUPPORT) {
                self._handleDownEvents(e);
            }
            // This is in case someone wants just on('keyup'):
            results = self.trigger(self.scope + 'keyup', e, key, code);
            results = results.concat(self.trigger(self.scope + 'keyup:' + key.toLowerCase(), e));
            self._handleSeqEvents();
            handlePreventDefault(e, results);
        }
        // Remove the key from self.down even if we're filtered (state must stay accurate)
        self._removeDown(key);
        self._setModifiers(code, false); // Modifiers also need to stay accurate
//         self.log.debug('2 _keyup() keysHeld:', self.down, 'modifiers:', self.modifiers, 'seqBuffer:', self.seqBuffer, 'event:', e);
    };
    // This is my attempt at a grand unified theory of pointing device and touch input:
//     self.touches = {
//         0: [TouchEvent,TouchEvent],
//         1: [TouchEvent]
//     };
// NOTE: Pointer Events use pointerId instead of touches[0].identifier
    self._pointerdown = function(e) {
        var i, id,
            mouse = self.mouse(e),
            results = [],
            changedTouches = e.changedTouches,
            ptype = e.pointerType,
            event = 'pointer',
            d = ':down',
            notFiltered = self.filter(e);
        self.log.debug('_pointerdown() event: ' + e.type, e, mouse, 'downEvent:', self.temp._downEvent);
        if (e.type == 'mousedown' && noMouseEvents) {
            return; // We already handled this via touch/pointer events
        }
        if (ptype) { // PointerEvent
            if (ptype == 'touch') {
                id = e.pointerId;
                if (!self.touches[id]) {
                    self.touches[id] = e;
                }
            }
        } else if (changedTouches && changedTouches.length) { // TouchEvent
            // Regardless of the filter status we need to keep track of things
            for (i=0; i < changedTouches.length; i++) {
                id = changedTouches[i].identifier;
                if (!self.touches[id]) {
                    self.touches[id] = changedTouches[i];
                }
            }
        }
        xDown = getCoord(e, 'X');
        yDown = getCoord(e, 'Y');
        self._resetSeqTimeout();
        if (notFiltered) {
// Make sure we trigger both pointer:down and the more specific pointer:<button>:down (if available):
            results = self.trigger(self.scope + event + d, e);
            if (mouse.buttonName !== undefined) {
                event += ':' + mouse.buttonName;
                results = results.concat(self.trigger(self.scope + event + d, e));
                if (e.type == 'mousedown') {
                    // Trigger a mouse-specific event in case folks want separate touch/mouse events
                    results = results.concat(self.trigger(self.scope + 'mouse:' + mouse.buttonName + d, e));
                }
            }
            if (e.type == 'touchstart') {
                // Trigger a touch-specific event in case folks want separate touch/mouse events
                results = results.concat(self.trigger(self.scope + 'touch' + d, e));
            }
            handlePreventDefault(e, results);
        }
        self._addDown(event);
        self._handleDownEvents(e);
    };
    self._mousedown = self._pointerdown;
    self._touchstart = self._pointerdown;
    self._pointerup = function(e) {
        var i, id, mouse, click, xDiff, yDiff, event,
            changedTouches = e.changedTouches,
            ptype = e.pointerType,
            swipeThreshold = self.settings.swipeThreshold,
            results = [],
            u = ':up',
            pEvent = 'pointer';
        self.log.debug('_pointerup() event: ' + e.type, e, mouse, 'seqBuffer:', self.seqBuffer);
        if (ptype) { // PointerEvent
            if (ptype == 'touch') {
                id = e.pointerId;
                if (self.touches[id]) {
                    xDown = self.touches[id].pageX;
                    yDown = self.touches[id].pageY;
                    xDiff = e.pageX - xDown;
                    yDiff = e.pageY - yDown;
                    delete self.touches[id];
                }
            }
        } else if (changedTouches) {
            if (changedTouches.length) { // Should only ever be 1 for *up events
//                 console.log('changedTouches.length:', changedTouches.length);
                for (i=0; i < changedTouches.length; i++) {
                    id = changedTouches[i].identifier;
                    if (self.touches[id]) {
                        xDown = self.touches[id].pageX;
                        yDown = self.touches[id].pageY;
                        xDiff = e.pageX - xDown;
                        yDiff = e.pageY - yDown;
                        delete self.touches[id];
                    }
                }
            }
            // If movement is less than 20px call preventDefault() so we don't get mousedown/mouseup events
            if (Math.abs(e.pageX - xDown) < 20 && Math.abs(e.pageY - yDown) < 20) {
                noMouseEvents = true; // Prevent emulated mouse events
            }
//             if (Math.abs(getCoord(e, 'X') - xDown) < 20 && Math.abs(getCoord(e, 'Y') - yDown) < 20) {
//                 noMouseEvents = true; // Prevent emulated mouse events
//             }
            // If there was zero movement make sure we also fire a click event
            if (e.pageX == xDown && e.pageY == yDown) {
                click = true;
            }
//             if (getCoord(e, 'X') == xDown && getCoord(e, 'Y') == yDown) {
//                 click = true;
//             }
        }
        if (noMouseEvents && e.type == 'mouseup') {
            noMouseEvents = false;
            return;
        }
        self._resetSeqTimeout();
        if (self.filter(e)) {
    // Make sure we trigger both pointer:up and the more specific pointer:<button>:up:
            results = self.trigger(self.scope + pEvent + u, e);
            mouse = self.mouse(e);
            if (mouse.buttonName !== undefined) {
                pEvent += ':' + mouse.buttonName;
                results = results.concat(self.trigger(self.scope + pEvent + u, e));
                // Trigger a mouse-specific event in case folks want separate touch/mouse events
                results = results.concat(self.trigger(self.scope + 'mouse:' + mouse.buttonName + u, e));
            } else if (e.type == 'touchend') {
                results = results.concat(self.trigger(self.scope + 'touch' + u, e));
            }
            // Now perform swipe detection...
            xDiff = xDown - getCoord(e, 'X');
            yDiff = yDown - getCoord(e, 'Y');
//             console.log('xDiff:', xDiff, 'yDiff:', yDiff);
            event = 'swipe';
            if (Math.abs(xDiff) > Math.abs(yDiff)) {
                if (xDiff > swipeThreshold) {
//                     console.log('xDiff:', xDiff, ' > ', swipeThreshold);
                    event += ':left';
                } else if (xDiff < -(swipeThreshold)) {
//                     console.log('xDiff:', xDiff, ' < -', swipeThreshold);
                    event += ':right';
                }
            } else {
                if (yDiff > swipeThreshold) {
//                     console.log('yDiff:', yDiff, ' > ', swipeThreshold);
                    event += ':up';
                } else if (yDiff < -(swipeThreshold)) {
//                     console.log('yDiff:', yDiff, ' < -', swipeThreshold);
                    event += ':down';
                }
            }
            if (event != 'swipe') {
                self._removeDown(pEvent);
                HI._addDown(event);
                results = results.concat(HI._handleDownEvents(e));
                HI._handleSeqEvents();
                HI._removeDown(event);
            } else {
                self._handleSeqEvents();
                self._removeDown(pEvent);
                if (click) {
                    results = results.concat(self.trigger(self.scope + 'click', e));
                }
                handlePreventDefault(e, results);
            }
        }
        xDown = null;
        yDown = null;
    };
    self._mouseup = self._pointerup;
    self._touchend = self._pointerup;
    self._pointercancel = function(e) {
        // TODO
    };
// NOTE: Intentionally not sending click, dblclick, or contextmenu events to the
//       seqBuffer because that wouldn't make sense (no 'down' or 'up' equivalents).
    self._click = function(e) {
        var results, mouse = self.mouse(e),
            event = 'click',
            notFiltered = self.filter(e);
        self.log.debug('_click()', e, mouse);
        self._resetSeqTimeout();
        if (notFiltered) {
            if (mouse.left) { results = self.trigger(self.scope + event, e); }
            results = self.trigger(self.scope + event + ':' + mouse.buttonName, e);
            handlePreventDefault(e, results);
        }
    };
    self._tap = self._click;
// NOTE: dblclick with the right mouse button doesn't appear to work in Chrome
    self._dblclick = function(e) {
        var results, mouse = self.mouse(e),
            event = 'dblclick',
            notFiltered = self.filter(e);
        self.log.debug('_dblclick()', e, mouse);
        self._resetSeqTimeout();
        if (notFiltered) {
            // Trigger 'dblclick' for normal left dblclick
            if (mouse.left) { results = self.trigger(self.scope + event, e); }
            results = self.trigger(self.scope + event + ':' + mouse.buttonName, e);
            handlePreventDefault(e, results);
        }
    };
    self._wheel = function(e) {
        var results, mouse = self.mouse(e),
            notFiltered = self.filter(e),
            event = 'wheel';
        self.log.debug('_wheel()', e, mouse);
        self._resetSeqTimeout();
        if (notFiltered) {
            results = self.trigger(self.scope + event, e);
            if (mouse.wheelY > 0) { event += ':down'; }
            else if (mouse.wheelY < 0) { event += ':up'; }
            else if (mouse.wheelX > 0) { event += ':right'; }
            else if (mouse.wheelX < 0) { event += ':left'; }
            self._addDown(event);
            results = results.concat(self._handleDownEvents(e));
            handlePreventDefault(e, results);
            self._handleSeqEvents();
            self._removeDown(event);
        }
    };
    self._contextmenu = function(e) {
        var results, notFiltered = self.filter(e),
            event = 'contextmenu';
        self.log.debug('_contextmenu()', e);
        self._resetSeqTimeout();
        if (notFiltered) {
            results = self.trigger(self.scope + event, e);
        }
        handlePreventDefault(e, results);
    };
    self._composition = function(e) {
        var results,
            notFiltered = self.filter(e),
            data = e.data,
            event = 'compos';
        self.log.debug('_composition() (' + e.type + ')', e);
        if (notFiltered) {
            results = self.trigger(self.scope + e.type, e, data);
            if (data) {
                if (e.type == 'compositionupdate') {
                    event += 'ing:"' + data + '"';
                } else if (e.type == 'compositionend') {
                    event += 'ed:"' + data + '"';
                }
                results = results.concat(self.trigger(self.scope + event, e));
                handlePreventDefault(e, results);
            }
        }
    };
    self._compositionstart = self._composition;
    self._compositionupdate = self._composition;
    self._compositionend = self._composition;
    self._clipboard = function(e) {
        var data, results,
            notFiltered = self.filter(e),
            event = e.type + ':"';
        self.log.debug('_clipboard() (' + e.type + ')', e);
        if (notFiltered) {
            if (window.clipboardData) { // IE
                data = window.clipboardData.getData('Text');
            } else if (e.clipboardData) { // Standards-based browsers
                data = e.clipboardData.getData('text/plain');
            }
            if (!data && (e.type == 'copy' || e.type == 'cut')) {
                data = self.getSelText();
            }
            if (data) {
                // First trigger a generic event so folks can just grab the copied/cut/pasted data
                results = self.trigger(self.scope + e.type, e, data);
                // Now trigger a more specific event that folks can match against
                results = results.concat(self.trigger(self.scope + event + data + '"', e));
                handlePreventDefault(e, results);
            }
        }
    };
    self._paste = self._clipboard;
    self._copy = self._clipboard;
    self._cut = self._clipboard;
    self._select = function(e) {
        var results,
            data = self.getSelText(),
            event = e.type + ':"';
        self.log.debug('_select()', e, data);
        results = self.trigger(self.scope + e.type, e, data);
        if (data) {
            results = results.concat(self.trigger(self.scope + event + data + '"', e, data));
            handlePreventDefault(e, results);
        }
    };

    // API functions
    self.filter = function(event) {
        /**:HumanInput.filter(event)

        This function gets called before HumanInput events are triggered.  If it returns ``False`` then ``trigger()`` will not be called.

        Override this function to implement your own filter.

        .. note:: The given *event* won't always be a browser-generated event but it should always have a 'type' and 'target'.
        */
        var tagName = (event.target || event.srcElement).tagName,
            // The events we're concerned with:
            keyboardEvents = ['keydown', 'keyup', 'keypress'];
        if (keyboardEvents.indexOf(event.type) != -1) {
            // Don't trigger keyboard events if the user is typing into a form
            return !(tagName == 'INPUT' || tagName == 'SELECT' || tagName == 'TEXTAREA');
        }
        return true;
    };
    self.startRecording = function() {
        // Starts recording events so that self.stopRecording() can return the results
        self.recording = true;
        recordedEvents = [];
    };
    self.stopRecording = function() {
        // Returns an array of all the (unique) events that were fired since startRecording() was called
        self.recording = false;
        return recordedEvents.reduce(function(p, c) {
            if (p.indexOf(c) < 0) {p.push(c)};
            return p;
        }, []);
    };
    self.isDown = function(name) {
        /**:HumanInput.isDown(name)

        Returns ``true`` if the given *name* (string) is currently held (aka 'down' or 'pressed').  It works with simple keys like, 'a' as well as key combinations like 'ctrl-a'.

        .. note:: Strings are used to track keys because key codes are browser and platform dependent (unreliable).
        */
        var i, down, downAlt,
            downEvents = self._downEvents();
        name = name.toLowerCase();
        if (downEvents.indexOf(name) != -1) {
            return true;
        }
        for (i=0; i < self.down.length; i++) {
            down = self.down[i].toLowerCase();
            downAlt = downState[i].toLowerCase(); // In case something changed between down and up events
            if (name == down || name == downAlt) {
                return true;
            } else if (self.SHIFTKEYS.indexOf(self.down[i]) != -1) {
                if (name == self.ShiftKeyEvent) {
                    return true;
                }
            } else if (self.CONTROLKEYS.indexOf(self.down[i]) != -1) {
                if (name == self.ControlKeyEvent) {
                    return true;
                }
            } else if (self.ALTKEYS.indexOf(self.down[i]) != -1) {
                if (name == self.AltKeyEvent) {
                    return true;
                }
            } else if (self.OSKEYS.indexOf(self.down[i]) != -1) {
                if (name == self.OSKeyEvent) {
                    return true;
                }
            }
        }
        return false;
    };
    self.getSelText = function() {
        /**:HumanInput.getSelText()

        :returns: The text that is currently highlighted in the browser.

        Example:

            HumanInput.getSelText();
            "localhost" // Assuming the user had highlighted the word, "localhost"
        */
        var txt = '';
        if (window.getSelection) {
            txt = window.getSelection();
        } else if (document.getSelection) {
            txt = document.getSelection();
        } else if (document.selection) {
            txt = document.selection.createRange().text;
        } else {
            return;
        }
        return txt.toString();
    };
    self.on = function(events, callback, context, times) {
        normEvents(events).forEach(function(event) {
            event = self.aliases[event] || event; // Convert the alias, if any
            if (event.length == 1 && isUpper(event)) { // Convert uppercase chars to shift-<key> equivalents
                event = 'shift-' + event;
            }
            event = event.toLowerCase(); // All events are normalized to lowercase for consistency
            if (event.indexOf('-') != -1) { // Combo
                if (event.indexOf('->') == -1) {
                    // Pre-sort non-ordered combos
                    event = self._normCombo(event);
                }
            }
            var callList = self.events[event],
                callObj = {
                    callback: callback,
                    context: context,
                    times: times
                };
            if (!callList) {
                callList = self.events[event] = [];
            }
            callList.push(callObj);
        });
        return self;
    };
    self.once = function(events, callback, context) {
        return self.on(events, callback, context, 1);
    };
    self.off = function(events, callback, context) {
        var i, n;
        if (!arguments.length) { // Called with no args?  Remove all events:
            self.events = {};
        } else {
            events = events ? normEvents(events) : Object.keys(self.events);
            for (i in events) {
                var event = events[i],
                    callList = self.events[event];
                if (callList) {
                    var newList = [];
                    for (var n in callList) {
                        if (callback) {
                             if (callList[n].callback.toString() == callback.toString()) {
                                if (context && callList[n].context != context) {
                                    newList.push(callList[n]);
                                } else if (context === null && callList[n].context) {
                                    newList.push(callList[n]);
                                }
                             } else {
                                newList.push(callList[n]);
                             }
                        } else if (context && callList[n].context != context) {
                            newList.push(callList[n]);
                        }
                    }
                    if (!newList.length) {
                        delete self.events[event];
                    } else {
                        self.events[event] = newList;
                    }
                }
            }
        }
        return self;
    };
    self.trigger = function(events) {
        var i, j, event, callList, callObj,
            results = [], // Did we successfully match and trigger an event?
            args = [];
        events = normEvents(events);
        // So we use these two lines instead:
        Array.prototype.push.apply(args, arguments);
        args.shift(); // Remove 'events'
        for (i=0; i < events.length; i++) {
            event = self.aliases[events[i]] || events[i]; // Apply the alias, if any
            self.log.debug('Triggering:', event, args);
            if (self.recording) { recordedEvents.push(event); }
            callList = self.events[event];
            if (callList) {
                for (j=0; j < callList.length; j++) {
                    callObj = callList[j];
                    if (callObj.times) {
                        callObj.times -= 1;
                        if (callObj.times == 0) {
                            self.off(event, callObj.callback, callObj.context);
                        }
                    }
                    results.push(callObj.callback.apply(callObj.context || this, args));
                }
            }
        }
        return results;
    };
    // Some API shortcuts
    self.emit = self.trigger; // Some people prefer 'emit()'; we can do that!
    // Add some generic window/document events so plugins don't need to handle
    // them on their own; it's better to have *one* listener.
    if (typeof document.hidden !== "undefined") {
        document.addEventListener('visibilitychange', function(e) {
            if (document.hidden) {
                self.trigger('document:hidden', e);
            } else {
                self.trigger('document:visible', e);
            }
        }, false);
    }
    // Window resizing is *usually* a human-initiated event so why not?
    window.addEventListener('resize', function(e) {
        self.trigger('window:resize', e);
        // TODO: Add orientation info?
    }, false);
    // Orientation change is almost always human-initiated:
    if (window.orientation !== undefined) {
        window.addEventListener('orientationchange', function(e) {
            self.trigger('window:orientation', e);
            // NOTE: There's built-in aliases for 'landscape' and 'portrait'
            if (Math.abs(window.orientation) === 90) {
                self.trigger('window:orientation:landscape', e);
            } else {
                self.trigger('window:orientation:portrait', e);
            }
        }, false);
    }
    self.init(self);
};

HumanInput.plugins = [];
if (window.PointerEvent) { // If we have Pointer Events we don't need mouse/touch
    HumanInput.defaultListenEvents = defaultEvents.concat(pointerEvents);
} else {
    HumanInput.defaultListenEvents = defaultEvents.concat(mouseTouchEvents);
}

HumanInput.prototype.init = function(self) {
    /**:HumanInput.prototype.init(self)

    Initializes the HumanInput library and can also be used at any time to
    reset everything.
    */
    var i, plugin, initResult, attr;
    self.scope = ''; // The current event scope (empty string means global scope)
    self.down = []; // Tracks which keys/buttons are currently held down (pressed)
    self.modifiers = {}; // Tracks (traditional) modifier keys
    self.seqBuffer = []; // For tracking sequences like 'a b c'
    self.m_buttons = {}; // Tracks which mouse buttons are currently down
    self.touches = {}; // Tracks ongoing touch events
    self.temp = {}; // Stores temporary/fleeting state information
    // Built-in aliases
    self.aliases = {
        tap: 'click',
        middleclick: 'pointer:middle:click',
        rightclick: 'pointer:right:click',
        doubleclick: 'dblclick', // For consistency with naming
        tripleclick: Array(4).join('pointer:left ').trim(),
        quadrupleclick: Array(5).join('pointer:left ').trim(),
        konami: 'up up down down left right left right b a enter',
        portrait: 'window:orientation:portrait',
        landscape: 'window:orientation:landscape',
        hulksmash: 'faceplant'
    };
    self.events = {}; // Tracks functions attached to events
    finishedKeyCombo = false; // Internal state tracking of keyboard combos like ctrl-c
    downState = []; // Used to keep keydown and keyup events in sync when the 'key' gets replaced inside the keypress event
    self.temp.seqTimer = null;
    // Set or reset our event listeners
    self.off('hi:pause');
    self.on('hi:pause', function() {
        var events = self.settings.listenEvents;
        self.log.debug(l('Pause: Removing event listeners'));
        events.forEach(function(event) {
            if (_.isFunction(self['_'+event])) {
                self.elem.removeEventListener(event, self['_'+event], true);
            }
        });
    });
    self.off(['hi:initialized', 'hi:resume']); // In case of re-init
    self.on(['hi:initialized', 'hi:resume'], function() {
        var events = self.settings.listenEvents;
        self.log.debug(l('Start/Resume: Addding event listeners'));
        events.forEach(function(event) {
            if (_.isFunction(self['_'+event])) {
                self.elem.removeEventListener(event, self['_'+event], true);
                self.elem.addEventListener(event, self['_'+event], true);
            }
        });
    });
//     self.controlCodes = {0: "NUL", 1: "DC1", 2: "DC2", 3: "DC3", 4: "DC4", 5: "ENQ", 6: "ACK", 7: "BEL", 8: "BS", 9: "HT", 10: "LF", 11: "VT", 12: "FF", 13: "CR", 14: "SO", 15: "SI", 16: "DLE", 21: "NAK", 22: "SYN", 23: "ETB", 24: "CAN", 25: "EM", 26: "SUB", 27: "ESC", 28: "FS", 29: "GS", 30: "RS", 31: "US"};
//     for (var key in self.controlCodes) { self.controlCodes[self.controlCodes[key]] = key; } // Also add the reverse mapping
    // NOTE: These location-based keyMaps will only be necessary as long as Safari lacks support for KeyboardEvent.key.
    //       Some day we'll be able to get rid of these (hurry up Apple!).
    self.keyMaps = { // NOTE: 0 will be used if not found in a specific location
        // These are keys that we can only pick up on keydown/keyup and have no
        // straightforward mapping from their keyCode/which values:
        0: { // KeyboardEvent.DOM_KEY_LOCATION_STANDARD
            'Backspace': 8,
            'Tab': 9,
            'Enter': 13,
            'Shift': 16,
            'Control': 17,
            'Alt': 18,
            'Pause': 19,
            'CapsLock': 20,
            'Escape': 27,
            'Space': 32,
            'PageUp': 33,
            'PageDown': 34,
            'End': 35,
            'Home': 36,
            'ArrowLeft': 37,
            'Left': 37,
            'ArrowUp': 38,
            'Up': 38,
            'ArrowRight': 39,
            'Right': 39,
            'ArrowDown': 40,
            'Down' : 40,
            'PrintScreen': 42,
            'Insert': 45,
            'Delete': 46,
            'Semicolon': 59,
            '=': 61,
            'OS': 92,
            'Select': 93,
            'NumLock': 144,
            'ScrollLock': 145,
            'VolumeDown': 174,
            'VolumeUp': 175,
            'MediaTrackPrevious': 177,
            'MediaPlayPause': 179,
            ',': 188,
            '-': 189,
            '.': 190,
            '/': 191,
            '`': 192,
            '[': 219,
            '\\': 220,
            ']': 221,
            "'": 222,
            'AltGraph': 225,
            'Compose': 229
        },
        1: { // KeyboardEvent.DOM_LOCATION_LEFT
            'ShiftLeft': 16,
            'ControlLeft': 17,
            'AltLeft': 18,
            'OSLeft': 91
        },
        2: { // KeyboardEvent.DOM_LOCATION_RIGHT
            'ShiftRight': 16,
            'ControlRight': 17,
            'AltRight': 18,
            'OSRight': 92
        }
    };
    if (self.settings.uniqueNumpad) {
        self.keyMaps[3] = { // KeyboardEvent.DOM_LOCATION_NUMPAD
            'NumpadMultiply': 106,
            'NumpadAdd': 107,
            'NumpadSubtract': 109,
            'NumpadDecimal': 46,
            'Slash': 111
        }
    } else {
        self.keyMaps[3] = { // KeyboardEvent.DOM_LOCATION_NUMPAD
            '*': 106,
            '+': 107,
            '-': 109,
            '.': 46,
            '/': 111
        }
    }
    // The rest of the keyMaps are straightforward:
    // 1 - 0
    for (i = 48; i <= 57; i++) {
        self.keyMaps[0][i] = '' + (i - 48);
    }
    // A - Z
    for (i = 65; i <= 90; i++) {
        self.keyMaps[0][i] = String.fromCharCode(i);
    }
    // NUM_PAD_0 - NUM_PAD_9
    for (i = 96; i <= 105; i++) {
        self.keyMaps[3][i] = 'Numpad' + (i - 96);
    }
    // F1 - F12
    for (i = 112; i <= 123; i++) {
        self.keyMaps[0][i] = 'F' + (i - 112 + 1);
    }
    // Extra Mac keys:
    if (MACOS) {
        self.keyMaps[0] = {
            3: 'Enter',
            63289: 'NumpadClear',
            63276: 'PageUp',
            63277: 'PageDown',
            63275: 'End',
            63273: 'Home',
            63234: 'ArrowLeft',
            63232: 'ArrowUp',
            63235: 'ArrowRight',
            63233: 'ArrowDown',
            63302: 'Insert',
            63272: 'Delete'
        };
        for (i = 63236; i <= 63242; i++) {
            self.keyMaps[0][i] = 'F' + (i - 63236 + 1);
        }
    }
    // Make keyMaps work both forward and in reverse:
    for (i=0; i<=3; i++) {
        Object.keys(self.keyMaps[i]).forEach(function(key) {
            if (key.length > 1 && (!(isNaN(key)))) {
                key = parseInt(key);
            }
            self.keyMaps[i][self.keyMaps[i][key]] = key;
        });
    }
    // Enable plugins
    if (HumanInput.plugins.length) {
        for (i=0; i < HumanInput.plugins.length; i++) {
            plugin = new HumanInput.plugins[i](self);
            self.log.debug(l('Initializing Plugin:'), plugin.__name__);
            if (_.isFunction(plugin.init)) {
                initResult = plugin.init(self);
                for (attr in initResult.exports) {
                    self[attr] = initResult.exports[attr];
                }
            }
        }
    }
    self.trigger('hi:initialized', self);
};

HumanInput.prototype.logger = function(lvl, prefix) {
    var self = this,
        fallback = function() {
            var args = _.toArray(arguments);
            args[0] = prefix + self.levels[level] + ': ' + args[0];
            if (_.isFunction(window.console.log)) {
                window.console.log.apply(window.console, args);
            }
        },
        write = function(level) {
            var args = Array.prototype.slice.call(arguments, 1);
            if (prefix.length) { args.unshift(prefix); }
            if (level == 40 && self.logLevel <= 40) {
                if (_.isFunction(window.console.error)) {
                    window.console.error.apply(window.console, args);
                } else {
                    fallback.apply(self, args);
                }
            } else if (level == 30 && self.logLevel <= 30) {
                if (_.isFunction(window.console.warn)) {
                    window.console.warn.apply(window.console, args);
                } else {
                    fallback.apply(self, args);
                }
            } else if (level == 20 && self.logLevel <= 20) {
                if (_.isFunction(window.console.info)) {
                    window.console.info.apply(window.console, args);
                } else {
                    fallback.apply(self, args);
                }
            } else if (level == 10 && self.logLevel <= 10) {
                if (_.isFunction(window.console.debug)) {
                    window.console.debug.apply(window.console, args);
                } else {
                    fallback.apply(self, args);
                }
            }
        };
    prefix = prefix || '';
    if (prefix.length) { prefix += ':'; }
    self.levels = {
        40: 'ERROR',
        30: 'WARNING',
        20: 'INFO',
        10: 'DEBUG',
        'ERROR': 40,
        'WARNING': 30,
        'INFO': 20,
        'DEBUG': 10
    };
    self.setLevel = function(level) {
        level = level.toUpperCase();
        self.error = _.partial(write, 40);
        self.warn = _.partial(write, 30);
        self.info = _.partial(write, 20);
        self.debug = _.partial(write, 10);
        self.logLevel = level;
        if (isNaN(level)) {
            self.logLevel = level = self.levels[level];
        }
        // These conditionals are just a small performance optimization:
        if (level > 40) {
            self.error = noop;
        }
        if (level > 30) {
            self.warn = noop;
        }
        if (level > 20) {
            self.info = noop;
        }
        if (level > 10) {
            self.debug = noop;
        }
    };
    self.setLevel(lvl);
};

HumanInput.prototype.pushScope = function(scope) {
    /**:HumanInput.pushScope(scope)

    Pushes the given *scope* into HumanInput.scope.  Examples::

        > HI = HumanInput(window);
        > HI.pushScope('foo');
        > HI.scope;
        'foo:'
        > HI.pushScope('bar');
        > HI.scope;
        'foo.bar:'
    */
    if (this.scope.length) {
        this.scope = this.scope.slice(0, -1) + '.' + scope + ':';
    } else {
        this.scope = scope + ':';
    }
};

HumanInput.prototype.popScope = function() {
    /**:HumanInput.popScope()

    Pops (and returns) the last scope out of HumanInput.scope.  Examples::

        > HI = HumanInput(window);
        > HI.scope;
        'foo.bar:'
        > HI.popScope();
        > HI.scope;
        'foo:'
        > HI.popScope();
        > HI.scope;
        ''
    */
    if (this.scope.length) {
        this.scope = this.scope.slice(0, -1).split('.').slice(0, -1).join('.') + ':';
    }
    if (this.scope == ':') { this.scope = ''; }
};

HumanInput.prototype.pause = function() {
    /**:HumanInput.pause()

    Halts all triggering of events until :js:func:`HumanInput.resume` is called.
    */
    this.paused = true;
    this.trigger('hi:pause', this);
};

HumanInput.prototype.resume = function() {
    /**:HumanInput.resume()

    Restarts triggering of events after a call to :js:func:`HumanInput.pause`.
    */
    this.paused = false;
    this.trigger('hi:resume', this);
};

HumanInput.prototype._seqSlicer = function(seq) {
    /**:HumanInput._seqSlicer(seq)

    Returns all possible combinations of sequence events given a string of keys.  For example::

        'a b c d'

    Would return:

        ['a b c d', 'b c d', 'c d']

    .. note:: There's no need to emit 'a b c' since it would have been emitted before the 'd' was added to the sequence.
    */
    var events = [], i, s, joined;
    // Split by spaces but ignore spaces inside quotes:
    seq = seq.split(/ +(?=(?:(?:[^"]*"){2})*[^"]*$)/g);
    for (i=0; i < seq.length-1; i++) {
        s = seq.slice(i);
        joined = s.join(' ');
        if (events.indexOf(joined) == -1) {
            events.push(joined);
        }
    }
    return events;
};

HumanInput.prototype._sortEvents = function(events) {
    var i, self = this,
        ctrlKeys = self.CONTROLKEYS.concat(['ctrl']),
        altKeys = self.ALTKEYS.concat(self.AltAltNames),
        osKeys = self.OSKEYS.concat(self.AltOSNames),
        priorities = {};
    for (i=0; i < ctrlKeys.length; i++) {
        priorities[ctrlKeys[i].toLowerCase()] = 5;
    }
    for (i=0; i < self.SHIFTKEYS.length; i++) {
        priorities[self.SHIFTKEYS[i].toLowerCase()] = 4;
    }
    for (i=0; i < altKeys.length; i++) {
        priorities[altKeys[i].toLowerCase()] = 3;
    }
    for (i=0; i < osKeys.length; i++) {
        priorities[osKeys[i].toLowerCase()] = 2;
    }
    // Basic (case-insensitive) lexicographic sorting first
    events.sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    // Now sort by length
    events.sort(function (a, b) { return b.length - a.length; });
    // Now apply our special sorting rules
    events.sort(function(a, b) {
        a = a.toLowerCase();
        b = b.toLowerCase();
        if (a in priorities) {
            if (b in priorities) {
                if (priorities[a] > priorities[b]) { return -1 }
                else if (priorities[a] < priorities[b]) { return 1 }
                else { return 0 }
            }
            return -1;
        } else if (b in priorities) {
            return 1;
        } else {
            return 0;
        }
    });
    return events;
};

HumanInput.prototype._normCombo = function(event) {
    /**:HumanInput._normCombo(event)

    Returns normalized (sorted) event combos (i.e. events with '-').  When given things like, '⌘-Control-A' it would return 'ctrl-os-a'.

    It replaces alternate key names such as '⌘' with their internally-consistent versions ('os') and ensures consistent (internal) ordering using the following priorities:

    1. ctrl
    2. shift
    3. alt
    4. os
    5. length of event name
    6. Lexicographically

    Events will always be sorted in that order.
    */
    var self = this, i,
        events = event.split('-'), // Separate into parts
        elen = events.length,
        ctrlCheck = function(key) {
            if (key == 'control') { // This one is simpler than the others
                return self.ControlKeyEvent;
            }
            return key;
        },
        altCheck = function(key) {
            for (var j=0; j < self.AltAltNames.length; j++) {
                if (key == self.AltAltNames[j]) {
                    return self.AltKeyEvent;
                }
            }
            return key;
        },
        osCheck = function(key) {
            for (var j=0; j < self.AltOSNames.length; j++) {
                if (key == self.AltOSNames[j]) {
                    return self.OSKeyEvent;
                }
            }
            return key;
        };
    // First ensure all the key names are consistent
    for (i=0; i < elen; i++) {
        if (events[i] == '') { // Was a literal -
            events[i] == '-';
        }
        events[i] = events[i].toLowerCase();
        events[i] = ctrlCheck(events[i]);
        events[i] = altCheck(events[i]);
        events[i] = osCheck(events[i]);
    }
    // Now sort them
    self._sortEvents(events);
    return events.join('-');
};

HumanInput.prototype.mouse = function(e) {
    /**:HumanInput.prototype.mouse(e)

    Given a MouseEvent object, returns an object:

    .. code-block:: javascript

        {
            type:        e.type, // Just preserves it
            left:        boolean,
            right:       boolean,
            middle:      boolean,
            back:        boolean,
            forward:     boolean,
            eraser:      boolean,
            buttonName:  string
        }
    */
    var m = { type: e.type };
    if (e.type != 'mousemove' && e.type != 'mousewheel' && e.type != 'wheel') {
        if (e.button == 0) { m.left = true; m.buttonName = 'left'; }
        else if (e.button == 1) { m.middle = true; m.buttonName = 'middle'; }
        else if (e.button == 2) { m.right = true; m.buttonName = 'right'; }
        else if (e.button == 3) { m.back = true; m.buttonName = 'back'; }
        else if (e.button == 4) { m.forward = true; m.buttonName = 'forward'; }
        else if (e.button == 5) { m.forward = true; m.buttonName = 'eraser'; }
        else { m.buttonName = e.button; }
    }
    m.button = e.button; // Save original button number
    if (e.type == 'wheel' || e.type == 'mousewheel') {
        if (e.wheelDeltaX || e.wheelDeltaY) {
            m.wheelX = e.wheelDeltaX / -40 || 0;
            m.wheelY = e.wheelDeltaY / -40 || 0;
        } else if (e.wheelDelta) {
            m.wheelY = e.wheelDelta / -40;
        } else {
            m.wheelY = e.detail || 0;
        }
    }
    return m;
};


// Exports
window.HumanInput = HumanInput;

}).call(this);
/**
 * humaninput-gamepad.js
 * Copyright (c) 2016, Dan McDougall
 *
 * HumanInput Gamepad Plugin - Adds support for gamepads to HumanInput.
 */



(function() {
"use strict";

HumanInput.defaultListenEvents.push('gamepad');

var GamepadPlugin = function(HI) {
    /**:GamePadPlugin

    The HumanInput Gamepad plugin adds support for gamepads and joysticks allowing the use of the following event types:

        .. list-table:: Event Details
            :header-rows: 1
            * - Event
            - Details
            * - ``gpad:button:1:down``
            - Gamepad button 1 pressed
            * - ``gpad:button:1:up``
            - Gamepad button 1 released
            * - ``gpad:button:6``
            - Gamepad button 6 state changed (useful for pressure-sensitive buttons)
            * - ``gpad:axis:2``
            - Gamepad axis 2 changed state

    Detection Events
    ----------------
    Whenever a new gamepad is detected the 'gpad:connected' event will fire with the Gamepad object as the only argument.

    Button Events
    -------------
    When triggered, gpad:button events are called like so::

        trigger(event, buttonValue, gamepadObj);

    You can listen for button events using :js:func:`HumanInput.on` like so::

        // Ensure 'gamepad' is included in listenEvents if not calling gamepadUpdate() in your own loop:
        var settings = {listenEvents: ['keydown', 'keypress', 'keyup', 'gamepad']};
        var HI = new HumanInput(window, settings);
        var shoot = function(buttonValue, gamepadObj) {
            console.log('Fire! Button value:', buttonValue, 'Gamepad object:', gamepadObj);
        };
        HI.on('gpad:button:1:down', shoot); // Call shoot(buttonValue, gamepadObj) when gamepad button 1 is down
        var stopShooting = function(buttonValue, gamepadObj) {
            console.log('Cease fire! Button value:', buttonValue, 'Gamepad object:', gamepadObj);
        };
        HI.on('gpad:button:1:up', stopShooting); // Call stopShooting(buttonValue, gamepadObj) when gamepad button 1 is released (up)

    For more detail with button events (e.g. you want fine-grained control with pressure-sensitive buttons) just neglect to add ':down' or ':up' to the event::

        HI.on('gpad:button:6', shoot);

    .. note:: The given buttonValue can be any value between 0 (up) and 1 (down).  Pressure sensitive buttons (like L2 and R2 on a DualShock controller) will often have floating point values representing how far down the button is pressed such as ``0.8762931823730469``.

    Button Combo Events
    -------------------
    When multiple gamepad buttons are held down a button combo event will be fired like so::

        trigger("gpad:button:0-gpad:button:1", gamepadObj);

    In the above example gamepad button 0 and button 1 were both held down simultaneously.  This works with as many buttons as the gamepad supports and can be extremely useful for capturing diagonal movement on a dpad.  For example, if you know that button 14 is left and button 13 is right you can use them to define diagonal movement like so::

        on("gpad:button:13-gpad:button:14", downLeft);

    Events triggered in this way will be passed the Gamepad object as the only argument.

    .. note:: Button combo events will always trigger *before* other button events.

    Axis Events
    -----------

    When triggered, gpad:axis events are called like so::

        trigger(event, axisValue, GamepadObj);

    You can listen for axis events using :js:func:`HumanInput.on` like so::

        var moveBackAndForth = function(axisValue, gamepadObj) {
            if (axisValue < 0) {
                console.log('Moving forward at speed: ' + axisValue);
            } else if (axisValue > 0) {
                console.log('Moving backward at speed: ' + axisValue);
            }
        };
        HI.on('gpad:axis:1', moveBackAndForth);

    .. topic:: Game and Application Loops

        If your game or application has its own event loop that runs at least once every ~100ms or so then it may be beneficial to call :js:func:`HumanInput.gamepadUpdate` inside your own loop *instead* of passing 'gamepad' via the 'listenEvents' setting.  Calling :js:func:`HumanInput.gamepadUpdate` is very low overhead (takes less than a millisecond) but HumanInput's default gamepad update loop is only once every 100ms. If you don't want to use your own loop but want HumanInput to update the gamepad events more rapidly you can reduce the 'gpadInterval' setting.  Just note that if you set it too low it will increase CPU utilization which may have negative consequences for your application.

    .. note:: The update interval timer will be disabled if the page is no longer visible (i.e. the user switched tabs).  The interval timer will be restored when the page becomes visible again.  This is handled via the Page Visibility API (visibilitychange event).

    Gamepad State
    -------------
    The state of all buttons and axes on all connected gamepads/joysticks can be read at any time via the `HumanInput.gamepads` property::

        var HI = HumanInput();
        for (var i=0; i < HI.gamepads.length; i++) {
            console.log('Gamepad ' + i + ':', HI.gamepads[i]);
        });

    .. note:: The index position of a gamepad in the `HumanInput.gamepads` array will always match the Gamepad object's 'index' property.
    */
    var self = this;
    self.__name__ = 'GamepadPlugin';
    self.exports = {};
    self.gamepads = [];
    self._gamepadTimer = null;
    self.gamepadUpdate = function() {
        /**:GamepadPlugin.gamepadUpdate()

        .. note:: This method needs to be called in a loop.  See the 'Game and Application Loops' topic for how you can optimize gamepad performance in your own game or application.

        Updates the state of `HumanInput.gamepads` and triggers 'gpad:button' or 'gamepad:axes' events if the state of any buttons or axes has changed, respectively.

        This method will also trigger a 'gpad:connected' event when a new Gamepad is detected (i.e. the user plugged it in or the first time the page is loaded).
        */
        var i, j, index, prevState, gp, buttonState, event, bChanged,
            pseudoEvent = {'type': 'gamepad', 'target': HI.elem},
            gamepads = navigator.getGamepads();
        for (i = 0; i < gamepads.length; ++i) {
            if (gamepads[i]) {
                index = gamepads[i].index,
                gp = self.gamepads[index];
                if (!gp) {
                    self.log.debug('Gamepad ' + index + ' detected:', gamepads[i]);
                    HI.trigger('gpad:connected', gamepads[i]);
                    self.gamepads[index] = {
                        axes: [],
                        buttons: [],
                        timestamp: gamepads[i].timestamp,
                        id: gamepads[i].id
                    };
                    gp = self.gamepads[index];
                    // Prepopulate the axes and buttons arrays so the comparisons below will work:
                    for (j=0; j < gamepads[i].buttons.length; j++) {
                        gp.buttons[j] = {value: 0, pressed: false};
                    }
                    for (j=0; j < gamepads[i].axes.length; j++) {
                        gp.axes[j] = 0;
                    }
                    continue;
                } else {
                    if (gp.timestamp == gamepads[i].timestamp) {
                        continue; // Nothing changed
                    }
// NOTE: We we have to make value-by-value copy of the previous gamepad state because Gamepad objects retain references to their internal state (i.e. button and axes values) when copied using traditional methods.  Benchmarking has shown the JSON.parse/JSON.stringify method to be the fastest so far (0.3-0.5ms per call to gamepadUpdate() VS 0.7-1.2ms per call when creating a new object literal, looping over the axes and buttons to copy their values).
                    prevState = JSON.parse(JSON.stringify(gp)); // This should be slower but I think the JS engine has an optimization for this specific parse(stringify()) situation resulting in it being the fastest method
                    gp.timestamp = gamepads[i].timestamp;
                    gp.axes = gamepads[i].axes.slice(0);
                    for (j=0; j < prevState.buttons.length; j++) {
                        gp.buttons[j].pressed = gamepads[i].buttons[j].pressed;
                        gp.buttons[j].value = gamepads[i].buttons[j].value;
                    }
                }
                // Update the state of all down buttons (axes stand alone)
                for (j=0; j < gp.buttons.length; j++) {
                    buttonState = 'up';
                    if (gp.buttons[j].pressed) {
                        buttonState = 'down';
                    }
                    event = 'gpad:button:' + j;
                    if (buttonState == 'down') {
                        if (!HI.isDown(event)) {
                            HI._addDown(event);
                        }
                    } else {
                        if (HI.isDown(event)) {
                            HI._handleSeqEvents();
                            HI._removeDown(event);
                        }
                    }
                    if (gp.buttons[j].pressed != prevState.buttons[j].pressed) {
                        HI.trigger(HI.scope + event + ':' + buttonState, gp.buttons[j].value, gamepads[i]);
                        bChanged = true;
                    }
                    if (gp.buttons[j].value != prevState.buttons[j].value) {
                        HI.trigger(HI.scope + event + ':value', gp.buttons[j].value, gamepads[i]);
                    }
                }
                if (HI.filter(pseudoEvent)) {
                    for (j=0; j < prevState.axes.length; j++) {
                        if (gp.axes[j] != prevState.axes[j]) {
                            event = 'gpad:axis:' + j;
                            HI.trigger(HI.scope + event, gp.axes[j], gamepads[i]);
                        }
                    }
                    if (bChanged) {
                        HI._handleDownEvents(gamepads[i]);
                    }
                }
            }
        }
    };
    self.loadController = function(controller) {
        // Loads the given controller (object)
        for (var alias in controller) {
            HI.aliases[alias] = controller[alias];
        }
    }
    return self;
};

GamepadPlugin.prototype.init = function(HI) {
    /**:GamepadPlugin.init(HI)

    Initializes the Gamepad Plugin by performing the following:

        * Checks for the presence of the 'gpadInterval' and 'gpadCheckInterval' settings and applies defaults if not found.
        * Sets up an interval timer using 'gpadInterval' or 'gpadCheckInterval' that runs :js:func:`GamepadPlugin.gamepadUpdate` if a gamepad is found or not found, respectively *if* 'gamepad' is set in `HI.settings.listenEvents`.
        * Exports `GamepadPlugin.gamepads`, `GamepadPlugin._gamepadTimer`, and :js:func:`GamepadPlugin.gamepadUpdate` to the current instance of HumanInput.
        * Attaches to the 'visibilitychange' event so that we can disable/enable the interval timer that calls :js:func:`GamepadPlugin.gamepadUpdate` (`GamepadPlugin._gamepadTimer`).
    */
    var self = this,
        disableUpdate = function() {
            clearInterval(self._gamepadTimer);
        },
        enableUpdate = function() {
            clearInterval(self._gamepadTimer);
            if (self.gamepads.length) { // At least one gamepad is connected
                self._gamepadTimer = setInterval(self.gamepadUpdate, HI.settings.gpadInterval);
            } else {
                // Check for a new gamepad every few seconds in case the user plugs one in later
                self._gamepadTimer = setInterval(self.gamepadUpdate, HI.settings.gpadCheckInterval);
            }
        };
    self.log = new HI.logger(HI.settings.logLevel || 'INFO', '[HI Gamepad]');
    self.log.debug("Initializing Gamepad Plugin", self);
    // Hopefully this timing is fast enough to remain responsive without wasting too much CPU:
    HI.settings.gpadInterval = HI.settings.gpadInterval || 100; // .1s
    HI.settings.gpadCheckInterval = HI.settings.gpadCheckInterval || 3000; // 3s
    clearInterval(self._gamepadTimer); // In case it's already set
    if (HI.settings.listenEvents.indexOf('gamepad') != -1) {
        self.gamepadUpdate();
        enableUpdate();
        // Make sure we play nice and disable our interval timer when the user changes tabs
        HI.on('document:hidden', disableUpdate);
        HI.on('document:visibile', enableUpdate);
    }
    // Exports (these will be applied to the current instance of HumanInput)
    self.exports.gamepads = self.gamepads;
    self.exports._gamepadTimer = self._gamepadTimer;
    self.exports.gamepadUpdate = self.gamepadUpdate;
    self.exports.loadController = self.loadController;
    return self;
};

// The following is a WIP for adding aliases automatically depending on the detected gamepad type:

// The default controller layout.  The keys of this object represent alias names
// that will be assigned to HumanInput.aliases:
// GamepadPlugin.prototype.standardLayout = {
//     // NOTE: This layout should cover DualShock, Xbox controllers, and similar
//     'gpad:up': 'gpad:button:12',
//     'gpad:down': 'gpad:button:13',
//     'gpad:left': 'gpad:button:14',
//     'gpad:right': 'gpad:button:15',
//     'gpad:select': 'gpad:button:8',
//     'gpad:share': 'gpad:button:8',
//     'gpad:start': 'gpad:button:9',
//     'gpad:options': 'gpad:button:9',
//     'gpad:l1': 'gpad:button:4',
//     'gpad:l2': 'gpad:button:6',
//     'gpad:r1': 'gpad:button:5',
//     'gpad:r2': 'gpad:button:7'
// }

HumanInput.plugins.push(GamepadPlugin);

// Exports
// window.HumanInput = HumanInput;

}).call(this);
/**
 * humaninput-speechrec.js
 * Copyright (c) 2016, Dan McDougall
 *
 * HumanInput Speech Recognition Plugin - Adds support for speech recognition to HumanInput.
 */


(function() {
"use strict";

HumanInput.defaultListenEvents.push('speech');

var speechEvent = (
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    window.mozSpeechRecognition ||
    window.msSpeechRecognition ||
    window.oSpeechRecognition);

var SpeechRecPlugin = function(HI) {
    var self = this;
    self.__name__ = 'SpeechRecPlugin';
    self.exports = {};
    self._rtSpeech = []; // Tracks real-time speech so we don't repeat ourselves
    self._rtSpeechPop = function() {
        // Pop out the first item (oldest)
        self._rtSpeech.reverse();
        self._rtSpeech.pop();
        self._rtSpeech.reverse();
    };
    self._rtSpeechTimer = null;
    self.startSpeechRec = function() {
        self._recognition = new webkitSpeechRecognition();
        self.log.debug('Starting speech recognition', self._recognition);
        self._recognition.lang = HI.settings.speechLang || navigator.language || "en-US";
        self._recognition.continuous = true;
        self._recognition.interimResults = true;
        self._recognition.onresult = function(e) {
            var i, event, transcript;
            for (i = e.resultIndex; i < e.results.length; ++i) {
                transcript = e.results[i][0].transcript.trim();
                if (e.results[i].isFinal) {
// NOTE: We have to replace - with – (en dash aka \u2013) because strings like 'real-time' would mess up event combos
                    event = 'speech:"' +  transcript.replace(/-/g, '–') + '"';
                    HI._addDown(event);
                    HI._handleDownEvents(e, transcript);
                    HI._handleSeqEvents();
                    HI._removeDown(event);
                } else {
                    // Speech recognition that comes in real-time gets the :rt: designation:
                    event = 'speech:rt:' +  transcript.replace(/-/g, '–') + '"';
                    if (self._rtSpeech.indexOf(event) == -1) {
                        self._rtSpeech.push(event);
                        HI._addDown(event);
                        HI._handleDownEvents(e, transcript);
// NOTE: Real-time speech events don't go into the sequence buffer because it would
//       fill up with garbage too quickly and mess up the ordering of other sequences.
                        HI._removeDown(event);
                    }
                }
            }
        };
        self._started = true;
        self._recognition.start();
    };
    self.stopSpeechRec = function() {
        self.log.debug('Stopping speech recognition');
        self._recognition.stop();
        self._started = false;
    };
    return self;
};

SpeechRecPlugin.prototype.init = function(HI) {
    var self = this, l = HI.l;
    self.log = new HI.logger(HI.settings.logLevel || 'INFO', '[HI Speech]');
    self.log.debug(l("Initializing Speech Recognition Plugin"), self);
    HI.settings.autostartSpeech = HI.settings.autostartSpeech || false; // Don't autostart by default
    if (HI.settings.listenEvents.indexOf('speech') != -1) {
        if (speechEvent) {
            if (HI.settings.autostartSpeech) {
                self.startSpeechRec();
            }
            HI.on('document:hidden', function() {
                if (self._started) {
                    self.stopSpeechRec();
                }
            });
            HI.on('document:visible', function() {
                if (!self._started && HI.settings.autostartSpeech) {
                    self.startSpeechRec();
                }
            });
        } else { // Disable the speech functions
            self.startSpeechRec = HI.noop;
            self.stopSpeechRec = HI.noop;
        }
    }
    // Exports (these will be applied to the current instance of HumanInput)
    self.exports.startSpeechRec = self.startSpeechRec;
    self.exports.stopSpeechRec = self.stopSpeechRec;
    return self;
};

HumanInput.plugins.push(SpeechRecPlugin);

}).call(this);