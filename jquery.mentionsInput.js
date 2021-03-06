/*
 * Mentions Input
 * Version 1.0.2
 * Written by: Kenneth Auchenberg (Podio)
 *
 * Using underscore.js
 *
 * License: MIT License - http://www.opensource.org/licenses/mit-license.php
 */

(function ($, _, undefined) {

  // Settings
  var KEY = { BACKSPACE : 8, TAB : 9, RETURN : 13, ESC : 27, LEFT : 37, UP : 38, RIGHT : 39, DOWN : 40, COMMA : 188, SPACE : 32, HOME : 36, END : 35 }; // Keys "enum"
  var defaultSettings = {
    triggerChar   : '@',
    onDataRequest : $.noop,
    minChars      : 2,
    showAvatars   : true,
    elastic       : true,
    onCaret       : false,
    minCharsNoTrigger : 4,   // trigger complete after this many chars without a space; false to disable
    searchDelay       : 300, // won't start searching until there's no typing for Xms
    spaceResetDelay   : 200, // won't reset on space if typing within Xms
    onTriggerChar     : null, // callback when the user hits the triggerChar, for displaying initial lists
    classes       : {
      autoCompleteItemActive : "active"
    },
    templates     : {
      wrapper                    : _.template('<div class="mentions-input-box"></div>'),
      autocompleteList           : _.template('<div class="mentions-autocomplete-list"></div>'),
      autocompleteListItem       : _.template('<li data-ref-id="<%= id %>" data-ref-type="<%= type %>" data-display="<%= display %>"><%= content %></li>'),
      autocompleteListItemAvatar : _.template('<img src="<%= avatar %>" />'),
      autocompleteListItemIcon   : _.template('<div class="icon <%= icon %>"></div>'),
      mentionsOverlay            : _.template('<div class="mentions"><div></div></div>'),
      mentionItemSyntax          : _.template('@[<%= value %>](<%= type %>:<%= id %>)'),
      mentionItemHighlight       : _.template('<strong><span><%= value %></span></strong>')
    }
  };

  var utils = {
    htmlEncode       : function (str) {
      return _.escape(str);
    },
    highlightTerm    : function (value, term) {
      if (!term && !term.length) {
        return value;
      }
      return value.replace(new RegExp("(?![^&;]+;)(?!<[^<>]*)(" + term + ")(?![^<>]*>)(?![^&;]+;)", "gi"), "<b>$1</b>");
    },
    setCaratPosition : function (domNode, caretPos) {
      if (domNode.createTextRange) {
        var range = domNode.createTextRange();
        range.move('character', caretPos);
        range.select();
      } else {
        if (domNode.selectionStart) {
          domNode.focus();
          domNode.setSelectionRange(caretPos, caretPos);
        } else {
          domNode.focus();
        }
      }
    },
    rtrim: function(string) {
      return string.replace(/\s+$/,"");
    }
  };

  var MentionsInput = function (settings) {

    var domInput, elmInputBox, elmInputWrapper, elmAutocompleteList, elmWrapperBox, elmMentionsOverlay, elmActiveAutoCompleteItem;
    var mentionsCollection = [];
    var autocompleteItemCollection = {};
    var inputBuffer = [];
    var currentDataQuery;
    var timeout = null;

    settings = $.extend(true, {}, defaultSettings, settings );

    function initTextarea() {
      elmInputBox = $(domInput);

      if (elmInputBox.attr('data-mentions-input') == 'true') {
        return;
      }

      elmInputWrapper = elmInputBox.parent();
      elmWrapperBox = $(settings.templates.wrapper());
      elmInputBox.wrapAll(elmWrapperBox);
      elmWrapperBox = elmInputWrapper.find('> div.mentions-input-box');

      elmInputBox.attr('data-mentions-input', 'true');
      elmInputBox.bind('keydown', onInputBoxKeyDown);
      elmInputBox.bind('keypress', onInputBoxKeyPress);
      elmInputBox.bind('input', onInputBoxInput);
      elmInputBox.bind('click', onInputBoxClick);
      elmInputBox.bind('blur', onInputBoxBlur);

      // Elastic textareas, internal setting for the Dispora guys
      if( settings.elastic ) {
        elmInputBox.elastic();
      }

    }

    function initAutocomplete() {
      elmAutocompleteList = $(settings.templates.autocompleteList());
      elmAutocompleteList.appendTo(elmWrapperBox);
      elmAutocompleteList.delegate('li', 'mousedown', onAutoCompleteItemClick);
    }

    function initMentionsOverlay() {
      elmMentionsOverlay = $(settings.templates.mentionsOverlay());
      elmMentionsOverlay.prependTo(elmWrapperBox);
    }

    function updateValues() {
      var syntaxMessage = getInputBoxValue();

      _.each(mentionsCollection, function (mention) {
        var textSyntax = settings.templates.mentionItemSyntax(mention);
        syntaxMessage = syntaxMessage.replace(mention.value, textSyntax);
      });

      var mentionText = utils.htmlEncode(syntaxMessage);

      _.each(mentionsCollection, function (mention) {
        var formattedMention = _.extend({}, mention, {value: utils.htmlEncode(mention.value)});
        var textSyntax = settings.templates.mentionItemSyntax(formattedMention);
        var textHighlight = settings.templates.mentionItemHighlight(formattedMention);

        mentionText = mentionText.replace(textSyntax, textHighlight);
      });

      mentionText = mentionText.replace(/\n/g, '<br />');
      mentionText = mentionText.replace(/ {2}/g, '&nbsp; ');

      elmInputBox.data('messageText', syntaxMessage);
      elmMentionsOverlay.find('div').html(mentionText);
    }

    function resetBuffer() {
      clearTimeout(this.timeout);
      inputBuffer = [];
    }

    function updateMentionsCollection() {
      var inputText = getInputBoxValue();

      mentionsCollection = _.reject(mentionsCollection, function (mention, index) {
        return !mention.value || inputText.indexOf(mention.value) == -1;
      });
      mentionsCollection = _.compact(mentionsCollection);
    }

    function addMention(mention) {

      var currentMessage = getInputBoxValue();

      // Using a regex to figure out positions
      var regex = new RegExp("\\" + settings.triggerChar + currentDataQuery, "gi");
      var result = regex.exec(currentMessage);
      var startCaretPosition;
      var currentCaretPosition;

      if (!result) {
        var caret = elmInputBox.caret();

        currentCaretPosition = caret.begin + currentMessage.substr(caret.begin).match("\\s|$").index;
        startCaretPosition = currentCaretPosition - currentDataQuery.length;
        if (currentMessage[startCaretPosition] == ' ') {
          startCaretPosition += 1;
        }
      } else {
        startCaretPosition = regex.lastIndex - result[0].length;
        currentCaretPosition = regex.lastIndex;
      }

      var start = currentMessage.substr(0, startCaretPosition);
      var end = currentMessage.substr(currentCaretPosition, currentMessage.length);
      var startEndIndex = (start + mention.value).length + 1;

      mentionsCollection.push(mention);

      // Cleaning before inserting the value, otherwise auto-complete would be triggered with "old" inputbuffer
      resetBuffer();
      currentDataQuery = '';
      hideAutoComplete();

      // Mentions & syntax message
      if (end[0] != ' ') end = ' ' + end;
      var updatedMessageText = start + mention.value + end;
      elmInputBox.val(updatedMessageText);
      updateValues();

      // Set correct focus and selection
      elmInputBox.focus();
      utils.setCaratPosition(elmInputBox[0], startEndIndex);
    }

    function getInputBoxValue() {
      return elmInputBox.val();
    }

    // returns either the last word or up to two words following the
    // triggerChar, based on the position in the string
    function getQuery(string, position) {
        var spacePos = position + string.substr(position).match("\\s|$").index,
          substring = string.substr(0, spacePos),
          // start of regex changes depending on whether minCharsNoTrigger is enabled
          trigger = (settings.minCharsNoTrigger === false) ? (settings.triggerChar + "(") : ("(" + settings.triggerChar),
          lastWord = substring.match(trigger + "\\S+\\s)?\\S+$", "i");
        if (lastWord) return lastWord[0];
        // so we can still call onTriggerChar without any characters
        if (substring.match("(^|\\s)" + settings.triggerChar + "$")) return settings.triggerChar;
        return null;
    }

    // This is taken straight from live (as of Sep 2012) GitHub code. The
    // technique is known around the web. Just google it. Github's is quite
    // succint though. NOTE: relies on selectionEnd, which as far as IE is concerned,
    // it'll only work on 9+. Good news is nothing will happen if the browser
    // doesn't support it.
    function textareaSelectionPosition($el) {
      var a, b, c, d, e, f, g, h, i, j, k;
      if (!(i = $el[0])) return;
      if (!$(i).is("textarea")) return;
      if (i.selectionEnd == null) return;
      g = {
        position: "absolute",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        boxSizing: "content-box",
        top: 0,
        left: -9999
      }, h = ["boxSizing", "fontFamily", "fontSize", "fontStyle", "fontVariant", "fontWeight", "height", "letterSpacing", "lineHeight", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop", "textDecoration", "textIndent", "textTransform", "width", "word-spacing"];
      for (j = 0, k = h.length; j < k; j++) e = h[j], g[e] = $(i).css(e);
      return c = document.createElement("div"), $(c).css(g), $(i).after(c), b = document.createTextNode(i.value.substring(0, i.selectionEnd)), a = document.createTextNode(i.value.substring(i.selectionEnd)), d = document.createElement("span"), d.innerHTML = "&nbsp;", c.appendChild(b), c.appendChild(d), c.appendChild(a), c.scrollTop = i.scrollTop, f = $(d).position(), $(c).remove(), f
    }    

    function onAutoCompleteItemClick(e) {
      var elmTarget = $(this);
      var mention = autocompleteItemCollection[elmTarget.attr('data-uid')];

      addMention(mention);

      return false;
    }

    function onInputBoxClick(e) {
      resetBuffer();
    }

    function onInputBoxBlur(e) {
      hideAutoComplete();
    }

    function onInputBoxInput(e) {
      updateValues();
      updateMentionsCollection();

      // need to defer so elmInputBox.caret() gets the accurate caret position
      _.defer(function() {
        var lastWord = getQuery(getInputBoxValue(), elmInputBox.caret().begin);
        if (settings.minCharsNoTrigger && lastWord && lastWord.length >= settings.minCharsNoTrigger) {
          currentDataQuery = lastWord;
          doSearch.call(this, currentDataQuery);
        } else if (!settings.minCharsNoTrigger && lastWord && lastWord[0] === settings.triggerChar && lastWord.length >= (settings.minChars + 1)) {
          currentDataQuery = (lastWord.length > 1) ? lastWord.substr(1) : '';
          doSearch.call(this, currentDataQuery);
        } else if (lastWord && lastWord[0] === settings.triggerChar && _.isFunction(settings.onTriggerChar)) {
          currentDataQuery = (lastWord.length > 1) ? lastWord.substr(1) : '';
          settings.onTriggerChar.call(this, currentDataQuery, function (responseData) {
            populateDropdown(currentDataQuery, responseData);
          });
        } else {
          hideAutoComplete();
        }
      });
    }

    function onInputBoxKeyPress(e) {
      clearTimeout(this.resetTimeout);
      if(e.keyCode == KEY.SPACE && (_.contains(inputBuffer, ' ') || !_.contains(inputBuffer, settings.triggerChar))) {
        resetBuffer();
        hideAutoComplete();
        return;
      }

      if(e.keyCode !== KEY.BACKSPACE) {
        var typedValue = String.fromCharCode(e.which || e.keyCode);
        inputBuffer.push(typedValue);
      }
    }

    function onInputBoxKeyDown(e) {

      // This also matches HOME/END on OSX which is CMD+LEFT, CMD+RIGHT
      if (e.keyCode == KEY.LEFT || e.keyCode == KEY.RIGHT || e.keyCode == KEY.HOME || e.keyCode == KEY.END) {
        // Defer execution to ensure carat pos has changed after HOME/END keys
        _.defer(resetBuffer);

        // IE9 doesn't fire the oninput event when backspace or delete is pressed. This causes the highlighting
        // to stay on the screen whenever backspace is pressed after a highlighed word. This is simply a hack
        // to force updateValues() to fire when backspace/delete is pressed in IE9.
        if (navigator.userAgent.indexOf("MSIE 9") > -1) {
          _.defer(updateValues);
        }

        return;
      }

      if (e.keyCode == KEY.BACKSPACE) {
        _.defer(function() {
          if (getInputBoxValue().length === 0) {
            hideAutoComplete();
            resetBuffer();
          }
          if (navigator.userAgent.indexOf("MSIE 9") > -1) {
            resetBuffer();
            updateValues();
          }
        });
        
        inputBuffer = inputBuffer.slice(0, -1 + inputBuffer.length); // Can't use splice, not available in IE
        return;
      }

      if (!elmAutocompleteList.is(':visible')) {
        return true;
      }

      switch (e.keyCode) {
        case KEY.UP:
        case KEY.DOWN:
          var elmCurrentAutoCompleteItem = null;
          if (e.keyCode == KEY.DOWN) {
            if (elmActiveAutoCompleteItem && elmActiveAutoCompleteItem.length) {
              elmCurrentAutoCompleteItem = elmActiveAutoCompleteItem.next();
            } else {
              elmCurrentAutoCompleteItem = elmAutocompleteList.find('li').first();
            }
          } else {
            elmCurrentAutoCompleteItem = $(elmActiveAutoCompleteItem).prev();
          }

          if (elmCurrentAutoCompleteItem.length) {
            selectAutoCompleteItem(elmCurrentAutoCompleteItem);
          }

          return false;

        case KEY.RETURN:
        case KEY.TAB:
          if (elmActiveAutoCompleteItem && elmActiveAutoCompleteItem.length) {
            elmActiveAutoCompleteItem.trigger('mousedown');
            return false;
          }

          break;
      }

      return true;
    }

    function hideAutoComplete() {
      elmActiveAutoCompleteItem = null;
      elmAutocompleteList.empty().hide();
    }

    function selectAutoCompleteItem(elmItem) {
      elmItem.addClass(settings.classes.autoCompleteItemActive);
      elmItem.siblings().removeClass(settings.classes.autoCompleteItemActive);

      // if in an overflow container, make sure the current item is visibile (for keyboard nav)
      elmAutocompleteList.scrollTop(elmItem[0].offsetTop);

      elmActiveAutoCompleteItem = elmItem;
    }

    function populateDropdown(query, results) {
      elmAutocompleteList.show();

      // Filter items that has already been mentioned
      var mentionValues = _.map(mentionsCollection, function(item) {
        return item.type + item.id;
      });

      results = _.reject(results, function (item) {
        return _.include(mentionValues, item.type + item.id);
      });

      if (!results.length) {
        hideAutoComplete();
        return;
      }

      elmAutocompleteList.empty();
      var elmDropDownList = $("<ul>").appendTo(elmAutocompleteList).hide();

      _.each(results, function (item, index) {
        var itemUid = _.uniqueId('mention_');

        autocompleteItemCollection[itemUid] = _.extend({}, item, {value: item.name});
        if (_.isObject(item.rawListItem)) {
          elmListItem = $(item.rawListItem);
        } else if (_.isFunction(settings.templates.autocompleteListItem)) {
          var elmListItem = $(settings.templates.autocompleteListItem({
            'id'      : utils.htmlEncode(item.id),
            'display' : utils.htmlEncode(item.name),
            'type'    : utils.htmlEncode(item.type),
            'content' : utils.highlightTerm(utils.htmlEncode((item.name)), query)
          }));

          if (settings.showAvatars) {
            var elmIcon;

            if (item.avatar) {
              elmIcon = $(settings.templates.autocompleteListItemAvatar({ avatar : item.avatar }));
            } else {
              elmIcon = $(settings.templates.autocompleteListItemIcon({ icon : item.icon }));
            }
            elmIcon.prependTo(elmListItem);
          }
        }
        if (index === 0) {
          selectAutoCompleteItem(elmListItem);
        }
        elmListItem = elmListItem.attr('data-uid', itemUid).appendTo(elmDropDownList);
      });

      elmAutocompleteList.show();
      if (settings.onCaret) positionAutocomplete(elmAutocompleteList, elmInputBox);
      elmDropDownList.show();
    }

    function doSearch(query) {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(function() {

        var usingTriggerChar = (query[0] == settings.triggerChar);
        query = usingTriggerChar ? query.substr(1) : query;
        currentDataQuery = query;
        
        if (query && query.length && query.length >= settings.minChars) {
          settings.onDataRequest.call(this, 'search', query, function (responseData) {
            populateDropdown(query, responseData);
          }, usingTriggerChar);
        } else {
          hideAutoComplete();
        }
      }, settings.searchDelay);
    }

    function positionAutocomplete(elmAutocompleteList, elmInputBox) {
      var position = textareaSelectionPosition(elmInputBox),
          lineHeight = parseInt(elmInputBox.css('line-height'), 10) || 18;
      elmAutocompleteList.css('width', '12em'); // Sort of a guess
      elmAutocompleteList.css('left', position.left);
      elmAutocompleteList.css('top', lineHeight + position.top);
    }

    function resetInput() {
      elmInputBox.val('');
      mentionsCollection = [];
      updateValues();
    }

    // Public methods
    return {
      init : function (domTarget) {

        domInput = domTarget;

        initTextarea();
        initAutocomplete();
        initMentionsOverlay();
        resetInput();

        if( settings.prefillMention ) {
          addMention( settings.prefillMention );
        }
      },

      renderNote : function(rawText, mentions) {
        //rawText example: "@[user:123-users] some string"
        if (rawText === undefined) return;

        var regex,
            result,
            displayText,
            displayTextOverlay;

        displayText = displayTextOverlay = _.escape(rawText);

        mentions = mentions || mentionsCollection;
        _.each(mentions, function(m){
          if (m.type === 'Leads') {
            regex = new RegExp("Leads?-" + m.id, "gi");  
          } else {
            regex = new RegExp("@\\[" + m.type + ":" + m.id + "\\]", "gi");
          }
          result = regex.exec(displayText);
          
          if (result && result.length) {
            mentionsCollection.push(m);
             // @[user:123-users] -> Flavio daCosta
            displayText = displayText.replace(result[0], m.value);
             // @[user:123-users] -> <span>..Flavio daCosta..</span>
            displayTextOverlay = displayTextOverlay.replace(result[0], settings.templates.mentionItemHighlight(m));
          }
        }, this);

        //this is what the user sees
        elmInputBox.val(_.unescape(displayText));

        //this is what we send to the database.
        elmInputBox.data('messageText', rawText);

        //this is the html in the hidden div overlay
        elmMentionsOverlay.find('div').html(displayTextOverlay);
      },

      val : function (callback) {
        if (!_.isFunction(callback)) {
          return;
        }

        var value = mentionsCollection.length ? elmInputBox.data('messageText') : getInputBoxValue();
        callback.call(this, value);
      },

      reset : function () {
        resetInput();
      },

      getMentions : function (callback) {
        if (!_.isFunction(callback)) {
          return;
        }

        callback.call(this, mentionsCollection);
      }
    };
  };

  $.fn.mentionsInput = function (method, settings) {

    var outerArguments = arguments;

    if (typeof method === 'object' || !method) {
      settings = method;
    }

    return this.each(function () {
      var instance = $.data(this, 'mentionsInput') || $.data(this, 'mentionsInput', new MentionsInput(settings));

      if (_.isFunction(instance[method])) {
        return instance[method].apply(this, Array.prototype.slice.call(outerArguments, 1));

      } else if (typeof method === 'object' || !method) {
        return instance.init.call(this, this);

      } else {
        $.error('Method ' + method + ' does not exist');
      }

    });
  };

})(jQuery, _);

$.fn.caret = function (begin, end) {
    if (this.length == 0) return;
    if (typeof begin == 'number')
    {
        end = (typeof end == 'number') ? end : begin;
        return this.each(function ()
        {
            if (this.setSelectionRange)
            {
                this.setSelectionRange(begin, end);
            } else if (this.createTextRange)
            {
                var range = this.createTextRange();
                range.collapse(true);
                range.moveEnd('character', end);
                range.moveStart('character', begin);
                try { range.select(); } catch (ex) { }
            }
        });
    } else
    {
        if (this[0].setSelectionRange)
        {
            begin = this[0].selectionStart;
            end = this[0].selectionEnd;
        } else if (document.selection && document.selection.createRange)
        {
            var range = document.selection.createRange();
            begin = 0 - range.duplicate().moveStart('character', -100000);
            end = begin + range.text.length;
        }
        return { begin: begin, end: end };
    }
};
