(function() {
if (typeof window.console == "undefined") { console = { log: function() {} }; }
console.log("Chutney being read");

var BRISKET_URL = "http://brisket.transparencydata.com";
var SERVER_URL = "http://localhost:8000";
var MEDIA_URL = SERVER_URL + "/media";
var INFO_SEARCH_URL = SERVER_URL + "/search.json"

var stylesheets = [
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/themes/south-street/jquery-ui.css",
    SERVER_URL + "/media/css/style.css"
];
var scripts = [
    MEDIA_URL + "/js/raphael.js",
    MEDIA_URL + "/js/g.raphael-min.js",
    MEDIA_URL + "/js/g.pie.patched.js",
    MEDIA_URL + "/js/g.bar.jeremi.js",
    MEDIA_URL + "/js/brisket_charts.js",
    MEDIA_URL + "/js/underscore-1.0.4.js",

    "http://ajax.googleapis.com/ajax/libs/jquery/1.4/jquery.min.js",
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/jquery-ui.min.js"
];

var COOKIE_NAME = "chutney";
var COOKIE_DAYS = 365;
var spinner = "<img src='" + MEDIA_URL + "/img/spinner.gif' alt='spinner' />";
var scriptsInserted = false;
var $;

/**
 * Util
 **/
function recipientUrl(recipient) {
    return BRISKET_URL + "/politician/" + slugify(recipient.name) + "/" + recipient.id;
}
function organizationUrl(org) {
    return BRISKET_URL + "/organization/" + slugify(org.name) + "/" + org.id;
}

function dollarsToFloat(dollars) {
    // WATCHOUT: unicode version of &ndash; here.
    dollars = dollars.replace(/[–]/g, "-");
    dollars = dollars.replace(/[^-0-9\.]/g, "");
    return parseFloat(dollars);
}
function floatToDollars(float) {
    var stub;
    if (float < 0) {
        stub = "&ndash;$";
    } else {
        stub = "$";
    }
    return stub + Math.abs(float).toFixed(2);
}
// Largely copied from brisket_charts.js "piechart" implementation
function minipie(div, data, type) {
    var r = Raphael(div);
    var party_colors = {"Republicans": "#E60002", "Democrats": "#186582", "Other": "#DCDDDE"};
    var other_colors = ["#EFCC01", "#F2E388"];
    var slices = [];
    var keys = _.keys(data);
    var total = _(data).chain().values().reduce(0, function(memo, num) {
        return memo + num;
    }).value();

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = data[key];
        var color = (type && type == "party") ? party_colors[key] : other_colors[i];
        var percent = Math.round((value / total) * 100);
        var label = (key || ' ') + ' (' + percent + '%)';
        if (label.length > 1) {
            label = label[0].toUpperCase() + label.substr(1, label.length);
        }
        slices.push({
            value: value,
            label: label,
            color: color
        });
    }

    slices.sort(function(a, b) {
        return b.value - a.value;
    });

    var labels = _.map(slices, function(s){ return s.label });
    var values = _.map(slices, function(s){ return s.value });
    var colors = _.map(slices, function(s){ return s.color });

    var lbl = undefined;

    pie = r.g.piechart(20, 20, 17, values, {
        colors: colors,
        strokewidth: 0
    });
    pie.hover(function() {
        this.sector.stop();
        this.sector.scale(1.2, 1.2, this.cx, this.cy);
        lbl = r.text(30, 50, dollar(this.value.value));
        lbl.attr({"font-weight": 800, "font-size": "12px"});
        lbl.show();

    }, function() {
        this.sector.animate({scale: [1, 1, this.cx, this.cy]}, 500, "bounce");
        lbl.hide();
    });
}
function slugify(string) {
    return string.trim().toLowerCase().replace(/[^-a-z0-9]/g, '-');
}
function clean(string) {
    return string.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/*
* Transaction objects
*/
var TxPrototype = {
    setCorp: function(corp) {
        this.corp = corp;
        if (typeof corp !== "undefined") {
            var pb = this.corp.party_breakdown;
            r = pb.Republicans != undefined ? parseFloat(pb.Republicans[1]) : 0;
            d = pb.Democrats != undefined ? parseFloat(pb.Democrats[1]) : 0;
            o = pb.Other != undefined ? parseFloat(pb.Other[1]) : 0;
            var total = r + d + o;
            this.party_breakdown = {
                'Republicans': this.amount * (r / total),
                'Democrats': this.amount * (d / total),
                'Other': this.amount * (o / total)
            };
        } else {
            this.party_breakdown = undefined;
        }
    },
    getMappingId: function() {
        return (this.corp ? this.corp.info.id : "unmatched") + slugify(this.name);
    },
    getCorpUrl: function() {
        if (!this.corp) {
            return;
        } else {
            return organizationUrl(this.corp.info);
        }
    },
    getMatchName: function() {
        var override = chutney.overrides[this.name];
        return override != undefined ? override : this.name;
    }
}
function Tx(name, amount, date, orig, order) {
    this.name = name;
    this.amount = amount;
    this.date = date;
    this.orig = orig;
    this.order = order;
    var tx = this;
    this.setCorp();
    this.uniqueClass = "id" + order;
}
Tx.prototype = TxPrototype;

/*
* Public namespace for chutney methods
*/
var chutney = {
    /*
    *  Load necessary javascript and css, parse transactions, then query API.
    */
    start: function() {
        if (window.location.protocol + "//" + window.location.host == SERVER_URL) {
            // early out if we are at the page where the bookmarklet is
            // acquired.  Perhaps display instructions instead?
            return;
        }
        if (typeof window.jQuery == 'undefined') {
            if (!scriptsInserted) {
                var head = document.getElementsByTagName("head")[0];
                for (var i = 0; i < scripts.length; i++) {
                    var script = document.createElement("script");
                    script.src = scripts[i];
                    head.appendChild(script);
                }
                for (var i = 0; i < stylesheets.length; i++) {
                    var css = document.createElement("link");
                    css.rel = "stylesheet";
                    css.type = "text/css";
                    css.href = stylesheets[i];
                    css.media = "all";
                    head.appendChild(css);
                }
                scriptsInserted = true;
            }
            console.log("no jquery");
            setTimeout("chutney.start()", 50);
        } else if (typeof window.jQuery.ui == 'undefined') {
            console.log("no jquery-ui");
            setTimeout("chutney.start()", 50);
        } else {
            jQuery.noConflict();
            $ = jQuery;
            loadJQueryCookie();
            console.log("Chutney run!");
            chutney.setUp();
            // Funny scroll positions mess up modal dialog.
            $(window).scrollTop(0);
            chutney.div.dialog('open');
            // intermittent off-screen placement bug
            var offset = $(chutney.div).parents(".ui-dialog").offset();
            if (offset.top < 0) {
                $(chutney.div).parents(".ui-dialog").offset({
                    top: 0,
                    left: offset.left
                });
            }
            chutney.parseTransactions();
            chutney.queryApi();
            chutney.recipe();
        }
    },
    recipes: ["chopping &frac12; cup fresh mint&hellip;", 
        "adding a bunch of fresh cilantro&hellip;", 
        "crushing in 1 green chile&hellip;", 
        "1&frac12; tablespoons of onion&hellip;", 
        "3 tablespoons lemon&hellip;", 
        "salt&hellip;", 
        "blending&hellip;"],
    recipe: function() {
        if (chutney.recipeDone) {
            return;
        }
        if (chutney.recipeIndex == undefined) {
            chutney.recipeIndex = 0;
            $("#chutney .loading").html("<ul class='recipe'></ul>" + spinner);
        }
        $("#chutney .recipe").append("<li>" + chutney.recipes[chutney.recipeIndex] + "</li>");
        if (chutney.recipeIndex + 1 < chutney.recipes.length) {
            chutney.recipeIndex += 1;
        }
        setTimeout(chutney.recipe, 1500);
    },
    /*
    *  Create the overlay that we will display things in, and set up data structures.
    */
    setUp: function() {
        // A queue of functions to execute after we've loaded everything we need to
        // (e.g. to operate on DOM elements once they've been loaded, such as charts)
        chutney.postLoadQueue = [];
        if (chutney.div == undefined) {
            chutney.div = $(document.createElement("div")).attr({'id': "chutney"});
            chutney.div.html(
                "<div class='loading'>" + spinner + "</div>" +
                "<div id='chutneyContent' style='display: none;'>" +
                    "<h2>On average, your purchases supported:</h2>" +
                    "<div class='totals'>" + 
                        "<div id='totalPartyBreakdown' class='total-party-breakdown'>&nbsp;</div>" +
                        "<div id='recipientTotals' class='recipient-totals'>&nbsp;</div>" +
                    "</div>" +
                    "<div id='chutneyOverrides'></div>" + 
                    "<h2>Matched transactions (<span id='matchedPercentage'></span>%)</h2>" +
                    "<div id='chutneyMatched'></div>" +
                    "<h2>Unmatched transactions (<span id='unmatchedPercentage'></span>%)</h2>" +
                    "<div id='chutneyUnmatched'></div>" +
                "</div>");
            chutney.div.dialog({
                autoOpen: false,
                width: 950,
                minHeight: 500,
                modal: true,
                position: 'top',
                draggable: false,
                resizable: false,
                title: "Chutney: How hot is your money?"
            });
        }
        if (chutney.txdata == undefined) {
            chutney.txdata = {};
        }
        if (chutney.overrides == undefined) {
            chutney.overrides = {}
            var cookieData = $.cookie(COOKIE_NAME);
            if (cookieData) {
                var attr = $.cookie(COOKIE_NAME).split(";");
                for (var i = 0; i < attr.length; i++) {
                    var parts = attr[i].split("=");
                    chutney.overrides[unescape(parts[0])] = unescape(parts[1]);
                }
                // refresh cookie
                chutney.storeOverrides();
            }

        }
    },
    /*
    * Persist the user-defined overrides as a cookie.
    */
    storeOverrides: function() {
        var escaped = [];
        for (var name in chutney.overrides) {
            escaped.push(escape(name) + "=" + escape(chutney.overrides[name]));
        }
        $.cookie(COOKIE_NAME, escaped.join(";"), { expires: COOKIE_DAYS });
    },
    removeOverride: function(override) {
        console.log(override, chutney.overrides);
        delete chutney.overrides[unescape(override)];
        chutney.storeOverrides();
        chutney.drawOverrides();
        return false;
    },
    /*
    *  Pull transactions out of the current page.
    */
    parseTransactions: function() {
        // mint.com
        chutney.txdata.txs = [];
        chutney.txdata.tx_names = {};
        $("#transaction-list-body > tr").each(function(index) {
            var desc = $(this).children("td[title]");
            var name = desc.text();
            var tx = new Tx(name,
                dollarsToFloat($(this).children("td.money").text()),
                $(this).children("td.date").text(),
                desc.attr("title"),
                index
            );
            chutney.txdata.txs.push(tx);
            if (typeof chutney.txdata.tx_names[name] == "undefined") {
                chutney.txdata.tx_names[name] = [tx];
            } else {
                chutney.txdata.tx_names[name].push(tx);
            }
        });
    },
    queryApi: function() {
        var escaped = [];
        for (var name in chutney.txdata.tx_names) {
            if (chutney.overrides[name] != undefined) {
                if (chutney.overrides[name].length > 0) {
                    escaped.push(escape(chutney.overrides[name]));
                }
            } else {
                if (name.length > 0) {
                    escaped.push(escape(name));
                }
            }
        }
        var query = escaped.join(",");
        $(window).ajaxError(function(e, xhr, settings, exception) {
            console.log(e);
            console.log(xhr);
            $("#chutneyContent").html("Error communicating with server.");
        });
        console.log("querying...");
        $.getJSON(INFO_SEARCH_URL + "?q=" + query + "&callback=?", function(data) {
            chutney.recipeDone = true; // stop the blending
            var txdata = chutney.txdata;
            txdata.matched = [];
            txdata.unmatched = [];
            txdata.corps = data;
            for (var i = 0; i < chutney.txdata.txs.length; i++) {
                var tx = txdata.txs[i];
                if (txdata.corps[tx.getMatchName()] != undefined) {
                    tx.setCorp(txdata.corps[tx.getMatchName()]);
                    txdata.matched.push(tx);
                } else {
                    txdata.unmatched.push(tx);
                }
            }
            chutney.calculateTotals();
            chutney.show();
            console.log("done.");
        });
    },
    /*
    * Create and insert a single row into the appropriate table from the given tx.
    */
    insertRow: function(tx) {
        var list = tx.corp ? chutney.txdata.matched : chutney.txdata.unmatched;
        var newRow = chutney.buildTxRow(tx);
        var added = false;
        for (var j = 0; j < list.length; j++) {
            if (list[j].order > tx.order) {
                $("#chutney ." + list[j].uniqueClass).before(newRow);
                added = true;
                list.splice(j, 0, tx);
                break;
            }
        }
        if (!added) {
            // it goes at the end
            var table = tx.corp ? "matched" : "unmatched";
            $("#chutney table." + table).append(newRow);
            list.push(tx);
        }
        for (var i = 0; i < chutney.postLoadQueue.length; i++) {
            chutney.postLoadQueue[i]();
        }
        chutney.postLoadQueue = [];
    },
    removeMatch: function(mappingId) {
        $("." + mappingId).fadeOut(function() { $(this).remove(); });
        var tx;
        // Run as while loop, since we modify the array during looping and increment selectively.
        var i = 0;
        while (i < chutney.txdata.matched.length) {
            tx = chutney.txdata.matched[i];
            if (tx.getMappingId() == mappingId) {
                // remove old row and references.
                chutney.overrides[tx.name] = "";
                chutney.txdata.matched.splice(i, 1);
                tx.setCorp(undefined);
                delete chutney.txdata.corps[tx.getMatchName()];
                chutney.insertRow(tx);
            } else {
                i++;
            }
        }
        chutney.calculateTotals();
        chutney.drawTotals();
        chutney.storeOverrides();
        chutney.drawOverrides();
        return false;
    },
    addMatch: function(orig, newCorpName) {
        chutney.overrides[orig] = newCorpName;
        chutney.storeOverrides();
        chutney.drawOverrides();
        $.getJSON(INFO_SEARCH_URL + "?callback=?", {q: newCorpName},
            function(data) {
                var corp;
                for (var name in data) {
                    // add first entry
                    corp = data[name];
                    break;
                }
                chutney.txdata.corps[newCorpName] = corp;
                var i = 0;
                while (i < chutney.txdata.unmatched.length) {
                    var tx = chutney.txdata.unmatched[i];
                    if (tx.name == orig) {
                        // remove old row and references
                        chutney.txdata.unmatched.splice(i, 1);
                        $("#chutney ." + tx.uniqueClass).fadeOut(function() { $(this).remove(); });
                        // Insert the row in 'matched'
                        tx.setCorp(corp);
                        chutney.insertRow(tx);
                    } else {
                        i++;
                    }
                }
                chutney.calculateTotals();
                chutney.drawTotals();
            }
        );
    },
    calculateTotals: function() {
        var txdata = chutney.txdata;
        txdata.totals = {
            Republicans: 0,
            Democrats: 0,
            Other: 0,
            matched: 0,
            unmatched: 0,
            all_recipients: 0,
            recipients: {}
        };
        txdata.recipient_ids = {};
        for (var i = 0; i < txdata.txs.length; i++) {
            var tx = txdata.txs[i];
            if (tx.amount < 0) {
                if (tx.corp) {
                    txdata.totals.Republicans += tx.party_breakdown.Republicans;
                    txdata.totals.Democrats += tx.party_breakdown.Democrats;
                    txdata.totals.Other += tx.party_breakdown.Other;
                    txdata.totals.matched += tx.amount;
                    for (var j = 0; j < tx.corp.recipients.length; j++) {
                        var recipient = tx.corp.recipients[j];
                        if (txdata.totals.recipients[recipient.name] == undefined) {
                            txdata.totals.recipients[recipient.name] = 0;
                        }
                        var val = parseFloat(recipient.total_amount);
                        txdata.totals.recipients[recipient.name] += val;
                        txdata.totals.all_recipients += val;
                        txdata.recipient_ids[recipient.name] = recipient.id;
                    }
                } else {
                    txdata.totals.unmatched += tx.amount
                }
            }
        }
    },
    buildTxRow: function(tx) {
        var amountClass = (tx.amount > 0 ? "pos" : "neg");
        if (tx.corp) {
            var issues = "Issues: " + tx.corp.issues_lobbied_for.join(", ");
            issues = issues.substring(0, 130) + 
                (issues.length > 100 ? "<a href='" + tx.getCorpUrl() + "'>...</a> &nbsp;" : "");
            issues += "<br />Politicians: ";
            var recipient_links = [];
            for (var i = 0; i < Math.min(tx.corp.recipients.length, 4); i++) {
                recipient_links.push("<a href='" + recipientUrl(tx.corp.recipients[i]) + "'>" +
                    tx.corp.recipients[i].name + "</a>");
            }
            issues += recipient_links.join(", ");
            var partyBreakdownId = "partyBreakdown" + tx.uniqueClass;
            if (true) { //tx.amount < 0) {
                var pb = {};
                for (var party in tx.corp.party_breakdown) {
                    pb[party] = parseFloat(tx.corp.party_breakdown[party][1]);
                }
                chutney.postLoadQueue.push(function() {
                    minipie(partyBreakdownId, pb, "party");
                });
            }

            out = "<tr class='chutney-tx matched " + tx.getMappingId() + " " + tx.uniqueClass + "'>" +
                    "<td class='date'>" + tx.date + "</td>" +
                    "<td title='" + tx.orig + "'>" + tx.name + ": " +
                        "<a class='match' href='" + tx.getCorpUrl() + "'>" + tx.corp.info.name + "</a>" +
                        "<span class='wrong-match'>(Is this the " +
                            "<a href='' onclick='return chutney.removeMatch(\"" + 
                                          tx.getMappingId()  + "\");'>wrong match</a>?)" +
                        "</span>" +
                    "</td>" +
                    "<td class='amount " + amountClass + "'>" + tx.amount + "</td>" +
                    "<td class='party-breakdown' rowspan='2'>" +
                        "<div class='tx-party-breakdown' id='" + partyBreakdownId + "'></div>" +
                    "</td>" +
                "</tr>" +
                "<tr class='chutney-issues " + tx.getMappingId() + "'>" +
                    "<td colspan='2'>" + issues + "</td>" +
                "</tr>";
        } else {
            out = "<tr class='chutney-tx unmatched " + tx.getMappingId() + " " + tx.uniqueClass + "'>" +
                        "<td class='date'>" + tx.date + "</td>" + 
                        "<td class='orig' title='" + tx.orig + "'>" + tx.name + "</td>" +
                        "<td class='add'>" +
                            "<form class='chutney-add' action='' onsubmit='return false;'>" +
                                "<label for='name'>Match</label>" +
                                "<input type='text' name='name' class='add-name' />" +
                                "<input type='submit', value='Add' />" +
                            "</form>" +
                            "<span class='loading' style='display: none;'>" + spinner + "</span>" +
                            "<div class='error'></div>" +
                        "</td>" +
                        "<td class='amount " + amountClass + "'>" + floatToDollars(tx.amount) + "</td>" +
                   "</tr>";
            chutney.postLoadQueue.push(function() {
                chutney.addAutocompletes("#chutney ." + tx.uniqueClass);
            });
        }
        return out;
    },
    drawTxs: function() {
        var matched = $(document.createElement("table"))
                        .attr({'class': 'chutney-txs matched', 'cellspacing': 0});
        var unmatched = $(document.createElement("table"))
                        .attr({'class': 'chutney-txs unmatched', 'cellspacing': 0});
        for (var i = 0; i < chutney.txdata.matched.length; i++) {
            $(chutney.buildTxRow(chutney.txdata.matched[i])).each(function() {
                matched.append(this);
            });
        }
        for (var i = 0; i < chutney.txdata.unmatched.length; i++) {
            $(chutney.buildTxRow(chutney.txdata.unmatched[i])).each(function() {
                unmatched.append(this);
            });
        }
        $("#chutneyMatched").html(matched);
        $("#chutneyUnmatched").html(unmatched);

        // match adding UI
        $("#chutney tr.unmatched").bind({
            "mouseover": function() {
                $(this).find("form.chutney-add").css("visibility", "visible");
            },
            "mouseout": function() {
                var form = $(this).find("form.chutney-add");
                var input = $(form).find("input.add-name");
                if (!input.val()) {
                    $(form).css("visibility", "hidden");
                }
            }
        });
        chutney.addAutocompletes("#chutneyUnmatched .chutney-add");
    },
    addAutocompletes: function(parentSelector) {
        var doAddMatch = function(input, val) {
            input = $(input);
            input
                .attr("disabled", "disabled")
                .removeClass("bad-name")
                .addClass("ui-autocomplete-loading")
                .autocomplete("option", "disabled", true);
            var orig = input.parents("tr").find("td.orig").text();
            chutney.addMatch(orig, val ? val : input.val());
        };
        $(parentSelector).find("input.add-name").autocomplete({
            minLength: 2,
            source: function(request, responseCallback) {
                if (request.term.length > 1) {
                    var input = $(this.element);
                    $.getJSON(SERVER_URL + "/names.json?callback=?", request, function(data) {
                        responseCallback(data);
                        var cleaned = clean(request.term);
                        for (var i = 0; i < data.length; i++) {
                            if (cleaned == clean(data[i])) {
                                input.removeClass("bad-name");
                                break;
                            }
                        }
                    });
                }
            }, 
            search: function(event, ui) {
                $(event.target).addClass("bad-name");
            },
            change: function(event, ui) {
                if (!$(this).hasClass("bad-name") 
                        && !$(this).attr("disabled") 
                        && $(this).val().length > 0) {
                    doAddMatch(this);
                }
            },
            select: function(event, ui) {
                doAddMatch(this, ui.item.value);
            },
        }).bind({
            focus: function(event) {
                if ($(this).hasClass("bad-name")) {
                    $(this).autocomplete('search', $(this).val());
                    focusedInput = $(this);
                }
            }, 
            keyup: function(event) {
                if ($(this).val().length == 0) {
                    $(this).removeClass("bad-name");
                }
            }
        });
    },
    drawTotals: function() {
        var partyBreakdown = {
            'Republicans': Math.abs(Math.round(chutney.txdata.totals.Republicans)),
            'Democrats': Math.abs(Math.round(chutney.txdata.totals.Democrats)),
            'Other': Math.abs(Math.round(chutney.txdata.totals.Other))
        };
        $("#totalPartyBreakdown").html("");
        piechart("totalPartyBreakdown", partyBreakdown, "party");
        
        var recipientData = [];
        var ratio = Math.abs(chutney.txdata.totals.matched / chutney.txdata.totals.all_recipients);
        for (var name in chutney.txdata.totals.recipients) {
            recipientData.push({
                key: name.substring(0, 27) + (name.length > 27 ? "..." : ""),
                value: Math.round(chutney.txdata.totals.recipients[name] * ratio),
                href: recipientUrl({name: name, id: chutney.txdata.recipient_ids[name]})            });
        }
        recipientData.sort(function(a, b) {
            return b.value - a.value;
        });
        recipientData = recipientData.splice(0, 10);
        $("#recipientTotals").html("");
        barchart("recipientTotals", recipientData);
        var total = Math.abs(chutney.txdata.totals.matched) + Math.abs(chutney.txdata.totals.unmatched);
        $("#matchedPercentage").html(
            Math.abs(Math.round((chutney.txdata.totals.matched / total) * 100))
        );
        $("#unmatchedPercentage").html(
            Math.abs(Math.round((chutney.txdata.totals.unmatched / total) * 100))
        );
    },
    drawOverrides: function() {
        $("#chutneyOverrides").html("");
        var table = $(document.createElement("table")).attr("class", "overrides")
            .append($(document.createElement("thead"))
                .append($(document.createElement("tr"))
                    .append($(document.createElement("th")).html("Original name"))
                    .append($(document.createElement("th")).html("Custom name"))
                    .append($(document.createElement("th")).html("Remove"))
            )
        );
        var ovrArray = [];
        for (var name in chutney.overrides) {
            ovrArray.push([name, chutney.overrides[name]]);
        }
        if (ovrArray.length > 0) {
            ovrArray.sort();
            for (var i = 0; i < ovrArray.length; i++) {
                table.append(
                    $(document.createElement("tr"))
                        .append($(document.createElement("td")).html(ovrArray[i][0]))
                        .append($(document.createElement("td")).html(
                            ovrArray[i][1] == "" ? "none" : ovrArray[i][1]
                        ))
                        .append($(document.createElement("td")).html(
                            "<a href='#' onclick='return chutney.removeOverride(\"" + 
                                escape(ovrArray[i][1]) + "\");'>x</a>"))
                );
            }
            $("#chutneyOverrides").append("<h2>Custom matches</h2>");
            $("#chutneyOverrides").append(table);
        }
    },


    /*
    *  Do that UI magic.
    */
    show: function() {
        $("#chutney .loading").hide();
        $("#chutneyContent").show();
        chutney.drawTxs();
        chutney.drawTotals();
        for (var i = 0; i < chutney.postLoadQueue.length; i++) {
            chutney.postLoadQueue[i]();
        }
        chutney.postLoadQueue = [];
        chutney.drawOverrides();
    }
}

// functionized so we can load this after jQuery is loaded.
function loadJQueryCookie() {
    // taken from jQuery cookie plugin v1.0:
    // http://plugins.jquery.com/project/cookie
    jQuery.cookie = function(name, value, options) {
        if (typeof value != 'undefined') { // name and value given, set cookie
            options = options || {};
            if (value === null) {
                value = '';
                options.expires = -1;
            }
            var expires = '';
            if (options.expires && (typeof options.expires == 'number' || options.expires.toUTCString)) {
                var date;
                if (typeof options.expires == 'number') {
                    date = new Date();
                    date.setTime(date.getTime() + (options.expires * 24 * 60 * 60 * 1000));
                } else {
                    date = options.expires;
                }
                expires = '; expires=' + date.toUTCString(); // use expires attribute, max-age is not supported by IE
            }
            // CAUTION: Needed to parenthesize options.path and options.domain
            // in the following expressions, otherwise they evaluate to undefined
            // in the packed version for some reason...
            var path = options.path ? '; path=' + (options.path) : '';
            var domain = options.domain ? '; domain=' + (options.domain) : '';
            var secure = options.secure ? '; secure' : '';
            document.cookie = [name, '=', encodeURIComponent(value), expires, path, domain, secure].join('');
        } else { // only name given, get cookie
            var cookieValue = null;
            if (document.cookie && document.cookie != '') {
                var cookies = document.cookie.split(';');
                for (var i = 0; i < cookies.length; i++) {
                    var cookie = jQuery.trim(cookies[i]);
                    // Does this cookie string begin with the name we want?
                    if (cookie.substring(0, name.length + 1) == (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        }
    };
}

window.chutney = chutney;
console.log("Chutney all read");

})();
