// youtubejs.extractor.js — YouTube player preprocessor
// Follows the yt-dlp/ejs approach: run the whole modified player in WKWebView,
// find the combined n/sig function via "alr","yes" sentinel, inject solver code.
//
// Requires meriyah to be loaded first (injected at document-start by WKWebView).

(function() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined') ? window : this;
  if (!g.meriyah || typeof g.meriyah.parseScript !== 'function') {
    throw new Error('youtubejs.extractor requires meriyah to be loaded first');
  }

  var parseScript = g.meriyah.parseScript;

  // ===================== AST Helpers =====================

  function containsAlrYesSentinel(statements) {
    for (var i = 0; i < statements.length; i++) {
      if (checkNodeForAlrYes(statements[i])) return true;
    }
    return false;
  }

  function checkNodeForAlrYes(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'ExpressionStatement') {
      return checkNodeForAlrYes(node.expression);
    }
    if (node.type === 'CallExpression') {
      if (node.callee && node.callee.type === 'MemberExpression' &&
          node.arguments && node.arguments.length === 2 &&
          node.arguments[0].type === 'Literal' && node.arguments[0].value === 'alr' &&
          node.arguments[1].type === 'Literal' && node.arguments[1].value === 'yes') {
        return true;
      }
    }
    for (var key in node) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'range' || key === 'loc') continue;
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var val = node[key];
      if (Array.isArray(val)) {
        for (var j = 0; j < val.length; j++) {
          if (val[j] && typeof val[j] === 'object' && typeof val[j].type === 'string') {
            if (checkNodeForAlrYes(val[j])) return true;
          }
        }
      } else if (val && typeof val === 'object' && typeof val.type === 'string') {
        if (checkNodeForAlrYes(val)) return true;
      }
    }
    return false;
  }

  function extractFunctionInfo(statement) {
    var results = [];
    if (statement.type === 'FunctionDeclaration' && statement.id && statement.body && statement.body.body) {
      results.push({ name: statement.id.name, statements: statement.body.body });
    } else if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression') {
      var left = statement.expression.left;
      var right = statement.expression.right;
      if (right && right.type === 'FunctionExpression' && right.body && right.body.body) {
        var name = null;
        if (left.type === 'Identifier') name = left.name;
        else if (left.type === 'MemberExpression') name = memberExprToString(left);
        if (name) results.push({ name: name, statements: right.body.body });
      }
    } else if (statement.type === 'VariableDeclaration') {
      for (var i = 0; i < statement.declarations.length; i++) {
        var decl = statement.declarations[i];
        if (decl.id && decl.id.type === 'Identifier' && decl.init &&
            decl.init.type === 'FunctionExpression' && decl.init.body && decl.init.body.body) {
          results.push({ name: decl.id.name, statements: decl.init.body.body });
        }
      }
    }
    return results;
  }

  function memberExprToString(node) {
    if (!node || node.type !== 'MemberExpression') return null;
    var obj = node.object;
    var prop = node.property;
    var objStr = obj.type === 'Identifier' ? obj.name : (obj.type === 'MemberExpression' ? memberExprToString(obj) : null);
    var propStr = !node.computed && prop.type === 'Identifier' ? prop.name : null;
    if (objStr && propStr) return objStr + '.' + propStr;
    return null;
  }

  // ===================== Player Modification =====================

  function modifyPlayer(source) {
    var ast = parseScript(source, { ranges: true, loc: false, module: false });
    var body = ast.body;
    var innerBody = null;
    var skipFirst = false;
    var preambleCode = '';

    if (body.length === 1) {
      // ES6 player: (function(){...}).call(this)
      var stmt = body[0];
      if (stmt && stmt.type === 'ExpressionStatement' &&
          stmt.expression.type === 'CallExpression' &&
          stmt.expression.callee.type === 'MemberExpression' &&
          stmt.expression.callee.object.type === 'FunctionExpression') {
        innerBody = stmt.expression.callee.object.body.body;
      }
    } else if (body.length === 2) {
      // IAS player: var _yt_player={}; (function(g){var window=this; ...})(_yt_player)
      var firstStmt = body[0];
      var stmt2 = body[1];
      if (stmt2 && stmt2.type === 'ExpressionStatement' &&
          stmt2.expression.type === 'CallExpression' &&
          stmt2.expression.callee.type === 'FunctionExpression') {
        var iifeFunc = stmt2.expression.callee;
        innerBody = iifeFunc.body.body;
        skipFirst = true; // Skip 'var window = this;'

        // Extract the first statement (e.g., 'var _yt_player = {};')
        if (firstStmt) {
          var firstRange = firstStmt.range || [firstStmt.start, firstStmt.end];
          if (firstRange && typeof firstRange[0] === 'number') {
            preambleCode += source.slice(firstRange[0], firstRange[1]) + ';\n';
          }
        }

        // Extract IIFE param name and argument
        if (iifeFunc.params && iifeFunc.params.length > 0 && iifeFunc.params[0].type === 'Identifier') {
          var paramName = iifeFunc.params[0].name;
          var iifeArgs = stmt2.expression.arguments;
          if (iifeArgs && iifeArgs.length > 0) {
            var argRange = iifeArgs[0].range || [iifeArgs[0].start, iifeArgs[0].end];
            if (argRange && typeof argRange[0] === 'number') {
              preambleCode += 'var ' + paramName + ' = ' + source.slice(argRange[0], argRange[1]) + ';\n';
            }
          } else {
            preambleCode += 'var ' + paramName + ' = {};\n';
          }
        }
      }
    }

    if (!innerBody) {
      throw new Error('Unexpected player structure: body.length=' + body.length);
    }

    var pieces = [];
    var nsigFunctionNames = [];
    var startIdx = skipFirst ? 1 : 0;

    if (preambleCode) pieces.push(preambleCode);

    for (var i = startIdx; i < innerBody.length; i++) {
      var node = innerBody[i];
      var keep = false;
      switch (node.type) {
        case 'VariableDeclaration':
        case 'FunctionDeclaration':
          keep = true;
          break;
        case 'ExpressionStatement':
          if (node.expression.type === 'AssignmentExpression') keep = true;
          else if (node.expression.type === 'Literal') keep = true;
          break;
      }
      if (keep) {
        var range = node.range || [node.start, node.end];
        if (range && typeof range[0] === 'number' && typeof range[1] === 'number') {
          pieces.push(source.slice(range[0], range[1]));
        }
        var funcInfos = extractFunctionInfo(node);
        for (var j = 0; j < funcInfos.length; j++) {
          if (containsAlrYesSentinel(funcInfos[j].statements)) {
            nsigFunctionNames.push(funcInfos[j].name);
          }
        }
      }
    }

    return {
      code: pieces.join(';\n'),
      nsigFunctionNames: nsigFunctionNames
    };
  }

  // ===================== Solver Code Generation =====================

  function generateSolverCode(nsigFunctionNames) {
    if (nsigFunctionNames.length === 0) return '';

    var solverFns = [];
    for (var i = 0; i < nsigFunctionNames.length; i++) {
      var fname = nsigFunctionNames[i];
      solverFns.push(
        '  function solver_' + i + '(input) {\n' +
        '    var url = (' + fname + ')("https://youtube.com/watch?v=yt-dlp-wins", "s",\n' +
        '      input.sig ? encodeURIComponent(input.sig) : undefined);\n' +
        '    url.set("n", input.n);\n' +
        '    var proto = Object.getPrototypeOf(url);\n' +
        '    var keys = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));\n' +
        '    for (var k = 0; k < keys.length; k++) {\n' +
        '      var key = keys[k];\n' +
        '      if (["constructor","set","get","clone"].indexOf(key) === -1 && typeof url[key] === "function") {\n' +
        '        try {\n' +
        '          url[key]();\n' +
        '          if ((input.n && url.get("n") !== input.n) || (input.sig && url.get("s") !== encodeURIComponent(input.sig))) {\n' +
        '            break;\n' +
        '          }\n' +
        '        } catch(err) {}\n' +
        '      }\n' +
        '    }\n' +
        '    var s = url.get("s");\n' +
        '    return {\n' +
        '      sig: s ? decodeURIComponent(s) : null,\n' +
        '      n: url.get("n") || null\n' +
        '    };\n' +
        '  }'
      );
    }

    return [
      'window._yt_result = {};',
      '(function() {',
      solverFns.join('\n'),
      '  var solvers = [' + nsigFunctionNames.map(function(_, i) { return 'solver_' + i; }).join(', ') + '];',
      '  window._yt_result.n = function(val) {',
      '    for (var i = 0; i < solvers.length; i++) {',
      '      try {',
      '        var res = solvers[i]({ n: val });',
      '        if (res && res.n && res.n !== val) {',
      '          return res.n;',
      '        }',
      '      } catch(e) {}',
      '    }',
      '    return val;',
      '  };',
      '  window._yt_result.sig = function(val) {',
      '    for (var i = 0; i < solvers.length; i++) {',
      '      try {',
      '        var res = solvers[i]({ sig: val });',
      '        if (res && res.sig && res.sig !== val) {',
      '          return res.sig;',
      '        }',
      '      } catch(e) {}',
      '    }',
      '    return val;',
      '  };',
      '})();'
    ].join('\n');
  }

  // ===================== Decipher Batch =====================

  function decipherBatch(itemsJson) {
    if (!window._yt_result) throw new Error('_yt_result not available');
    var items = JSON.parse(itemsJson);
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var newN = null;
      var newSig = null;
      try {
        if (item.n) newN = window._yt_result.n(item.n);
      } catch (e) { /* keep null */ }
      try {
        if (item.sig && item.isCipher) newSig = window._yt_result.sig(item.sig);
      } catch (e) { /* keep null */ }
      results.push({ itag: item.itag, newN: newN, newSig: newSig });
    }
    return JSON.stringify(results);
  }

  // ===================== Public API =====================

  g.YT_PREPROCESS = {
    preprocessAndEval: function(playerSource) {
      var modified = modifyPlayer(playerSource);

      if (modified.nsigFunctionNames.length === 0) {
        throw new Error('No nsig function found in player');
      }

      var fullCode = modified.code + '\n' + generateSolverCode(modified.nsigFunctionNames);
      (new Function(fullCode))();

      if (!window._yt_result || typeof window._yt_result.n !== 'function') {
        throw new Error('Solver functions not created after eval');
      }
    },

    decipher: decipherBatch
  };
})();
