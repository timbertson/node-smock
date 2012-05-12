// internal methods to detect & track mock objects
var mock_marker = {};
var _bookkeeper = null;

var is_mock = function(m) {
	if(m === undefined) return false;
	return m.__mock_marker == mock_marker;
};

var get_bookkeeper = function() {
	if(_bookkeeper === null) throw new Error("init() not called!");
	return _bookkeeper;
};

// util
var extend = function(instance, proto) {
	for(var k in proto) {
		if(proto.hasOwnProperty(k)) {
			instance[k] = proto[k];
		}
	}
	return instance;
};



// Exported as mock()
// create a mock, with optional name and template (either
// an array of strings, or an object with keys)
// If template is provided, the mock will
// be primed with all method names from the template
var make_mock = function(name, template) {
	name = name || '[unknown mock]';
	var mock = function() {
		mock.__calls.push(Array.prototype.slice.call(arguments));
		for(var i=mock.__responses.length-1; i>=0; i--) { // note: we give the MOST RECENT behaviour a chance to act first
			var response = mock.__responses[i];
			if(response.handles.apply(response, arguments)) {
				return response.invoke.apply(response, arguments);
			}
		}
		//throw new Error(mock + " received unexpected call(" + Array.prototype.slice.call(arguments).join(", ") + ")");
	};
	extend(mock, {
		__mock_marker: mock_marker,
		__name: name,
		__responses: [],
		__calls: [],
		received_calls: function() { return Array.prototype.slice.call(this.__calls); }, // return a copy
		toString: function() { return "<mock: " + this.__name + ">";}
	});
	if(template) {
		var keys = template;
		if(!(template instanceof Array)) {
			keys = [];
			// copy all methods that aren't on the Object base class
			for(var k in template) {
				if(!(k in Object.prototype)) {
					keys.push(k);
				}
			}
		}
		_.each(keys, function(method) { mock[method] = make_mock(method); });
	}
	return mock;
};

var replace = function(subject, method, obj) {
	var previous, owner;
	var owner = subject;
	if(method in subject) {
		var previous = subject[method];
		while(!owner.hasOwnProperty(method)) {
			owner = owner.__proto__; // todo: does this work cross-platform
			if(owner == Object.prototype) {
				throw new Error("can't determine owner of property: " + method);
			}
		};
	} else {
		previous = undefined;
	}
	get_bookkeeper().add_replacement([owner, method, obj]);
	return obj;
};

var expect_or_stub = function(subject, method, expect) {
	var mock;
	if(!method) {
		if(!is_mock(subject)) {
			throw new Error("can't use expect() or stub() on <" + subject + ">, unless you also provide a method name!");
		}
		// mock the subject's __call_ method:
		mock = subject;
	} else if(method in subject && is_mock(subject[method])) {
			mock = subject[method]; // reuse existing mock
	} else {
		mock = make_mock(method);
		replace(subject, method, mock);
	}
	var expectation = new Expectation(mock);
	if(!expect) {
		expectation.any_number_of_times();
	}
	return expectation;
};


// ------------------------------------------------
// The "Smock" object, which is exported into globals
// when you use "extend"
// ------------------------------------------------
var SmockGlobals = {};

SmockGlobals.expect = function(subject, method) {
	return expect_or_stub(subject, method, true);
};
SmockGlobals.when = function(subject, method) {
	return expect_or_stub(subject, method, false);
};
SmockGlobals.stub = SmockGlobals.when;
SmockGlobals.replace = replace;
SmockGlobals.mock = make_mock;
SmockGlobals.Smock = SmockGlobals;


// ------------------------------------------------
// Bookkeeper: keep track of all
// mocks & expectations for the duration of a test
// ------------------------------------------------
var Bookkeeper = function() {
	this.reset();
};
Bookkeeper.prototype.reset = function() {
	this.replacements = [];
	this.expectations = [];
};
Bookkeeper.prototype.add_expectation = function(exp) {
	this.expectations.push(exp);
};
Bookkeeper.prototype.add_replacement = function(exp) {
	this.replacements.push(exp);
};
Bookkeeper.prototype.finish = function() {
	this.replacements.reverse(); // ensure we do exactly the opposite of what was done
	this.replacements.forEach(function(replacement) {
		var subject = replacement[0];
		var property = replacement[1];
		var original = replacement[2];
		if(typeof(original) == 'undefined') {
			delete subject[property];
		} else {
			subject[property] = original;
		}
	});
	this.expectations.forEach(function(expectation) {
		expectation.verify();
	});
};

// ------------------------------------------------
// The expectation builder DSL. This is what
// gets returned from expect() and when()
// ------------------------------------------------
var Expectation = function(mock) {
	this.mock = mock;
	mock.__responses.push(this);
	get_bookkeeper().add_expectation(this);
	this.times = this; // for DSL sweetness
};

Expectation.prototype.toString = function(key, val) {
	return "[Expectation on " + this.mock + "]";
};

Expectation.prototype._set = function(key, val) {
	if(this._is_set(key)) {
		throw new Error("already defined " + key + " on " + this.mock);
	}
	this[key] = val;
	return this;
};

Expectation.prototype._is_set = function(key) {
	return this.hasOwnProperty(key);
};

Expectation.prototype.at_least = function(n) {
	this._set('num_calls', function(calls) { return calls >= n; });
	this.num_calls.desc = "at least " + n + " times";
	return this;
};

Expectation.prototype.at_most = function(n) {
	this._set('num_calls', function(calls) { return calls <= n; });
	this.num_calls.desc = "at most " + n + " times";
	return this;
};

Expectation.prototype.exactly = function(n) {
	this._set('num_calls', function(calls) { return calls == n; });
	this.num_calls.desc = "exactly " + n + " times";
	return this;
};

Expectation.prototype.any_number_of_times = function() { return this.at_least(0); };
Expectation.prototype.never = function() { return this.exactly(0); };
Expectation.prototype.once = function() { return this.exactly(1); };
Expectation.prototype.twice = function() { return this.exactly(2); };
Expectation.prototype.thrice = function() { return this.exactly(3); };

Expectation.prototype.with_args = function() {
	var expected = Array.prototype.slice.call(arguments); // make a shallow copy
	var self = this;
	this._set('args', function() { return self._compare(expected, Array.prototype.slice.call(arguments)); });
	this.args.desc = expected.join(", ");
	return this;
};
Expectation.prototype.where_args = function(f, ctx) {
	this._set('args', function() { return f.apply(this, arguments) });
	this.args.desc = f.toString();
	return this;
};
Expectation.prototype.and_return = Expectation.prototype.then_return = function(v) {
	return this._set('return_action', function() { return v; });
};
Expectation.prototype.and_call = Expectation.prototype.then_call = function(f) {
	return this._set('return_action', f);
};
Expectation.prototype.and_throw = Expectation.prototype.then_throw = function(e) {
	return this._set('return_action', function() { throw e; });
};
Expectation.prototype._compare = function(expecteds, actuals) {
	for(var i=0; i<expecteds.length; i++) {
		var expected = expecteds[i];
		var actual = actuals[i];
		var matches = (expected && typeof(expected.compare) != 'undefined') ? expected.compare(actual) : expected == actual;
		if(!matches) return false;
	}
	return true;
};

// methods used by the mock to determine actual behavior:
Expectation.prototype.handles = function() {
	if(!this._is_set('args')) {
		return true;
	}
	return this.args.apply(this.args, arguments);
};

Expectation.prototype._all_calls = function() {
	return this.mock.__calls;
};
Expectation.prototype._matching_call_count = function() {
	var calls = this.mock.__calls;
	var num = 0;
	for(var i=0; i<calls.length; i++) {
		var call = calls[i];
		if(this.handles.apply(this, call)) {
			num += 1;
		}
	}
	return num;
};

Expectation.prototype.invoke = function() {
	if(this._is_set('return_action')) {
		return this.return_action.apply(this, arguments);
	}
	return undefined;
};

Expectation.prototype.verify = function() {
	//console.log("verifying " + this.mock + " had " + (this.num_calls && this.num_calls.desc) + " calls with " + (this.args && this.args.desc) + ", from " + JSON.stringify(this.mock.__calls));
	if(!this._is_set('num_calls')) this.at_least(1).times;
	if(!this.num_calls(this._matching_call_count())) {
		throw new Error(this.report());
	}
};
Expectation.prototype.report = function() {
	var s = "expected " + this.mock.__name + " to be called ";
	if(this._is_set('num_calls')) {
		s += (this.num_calls.desc || '(unknown number of times)');
	} else {
		s += "any number of times";
	}
	if(this._is_set('args')) {
		s += " with (" + (this.args.desc || '<unknown argument matcher>') + ')';
	}
	s += ", but that happened " + this._matching_call_count() + " times.";
	var all_calls = this._all_calls();
	if(all_calls.length > 0) {
		s += "\n\nAll calls were:";
		for(var i=0; i < all_calls.length; i++) {
			var call = all_calls[i];
			s += "\n " + (i+1) + ") " + this.mock.__name + "(" + call.join(", ") + ")";
		}
		s += "\n";
	}
	return s;
};

var exports = module.exports = {};
// the exports are basically the global "Smock" object
extend(exports, SmockGlobals);

// but we add some additional properties that
// we want to export but not make part of the Smock
// exported functions
exports.extend = function(receiver) {
	extend(receiver, this);
	return this;
};
exports.init = function() {
	assert(_bookkeeper === null, "init() called twice in a row!");
	_bookkeeper = new Bookkeeper();
};
exports.finish = function() {
	assert(_bookkeeper !== null, "finish() called before init()");
	_bookkeeper.finish();
	_bookkeeper = null;
};
exports.is_mock = is_mock;
exports.Expectation = Expectation;

exports.mocha_hooks = {
	'test': exports.init,
	'test verify': exports.finish
};
