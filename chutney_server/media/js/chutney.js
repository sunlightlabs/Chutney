(function() {

var BRISKET_URL = "http://brisket.transparencydata.com";
var SERVER_URL = "http://localhost:8000";
var MEDIA_URL = SERVER_URL + "/media";

if (typeof window.console == "undefined") { console = { log: function() {} }; }
console.log("Chutney being read");
var scriptsInserted = false;
var stylesheets = [
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/themes/south-street/jquery-ui.css",
    SERVER_URL + "/media/css/style.css"
];
var scripts = [
    MEDIA_URL + "/js/raphael.js",
    MEDIA_URL + "/js/g.raphael-min.js",
    MEDIA_URL + "/js/g.pie.patched.js",
    MEDIA_URL + "/js/g.bar.jeremi.js",
    MEDIA_URL + "/js/g.line-min.js",
    MEDIA_URL + "/js/brisket_charts.js",
    MEDIA_URL + "/js/underscore-1.0.4.js",

    "http://ajax.googleapis.com/ajax/libs/jquery/1.4/jquery.min.js",
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/jquery-ui.min.js"
];
var $;
var spinner = "<img src='" + MEDIA_URL + "/img/spinner.gif' alt='spinner' />";

/**
 * Util
 **/

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
    string = string.toLowerCase();
    string = string.replace(/[^-a-z0-9]/g, '-');
    return string;
}
/*
*  Return the brisket URL for a politician given as {id: "...id...", name: "...name..."}
*/
function recipientUrl(recipient) {
    return BRISKET_URL + "/politician/" + slugify(recipient.name) + "/" + recipient.id;


}


/*
* Public namespace for chutney methods
*/
var chutney = {
    /*
    *  Load necessary javascript and css.  When loaded, call "run".
    */
    start: function() {
        if (window.location.protocol + "//" + window.location.host == SERVER_URL) {
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
            chutney.run();
        }
    },
    /*
    *  Pull corporation names out of the current page, then query brisket.
    */
    run: function() {
        console.log("Chutney run!");
        chutney.setUp();
        // Funny scroll positions mess up modal dialog.
        $(window).scrollTop(0);
        chutney.div.dialog('open');
        chutney.parseTransactions();
        chutney.queryBrisket();
    },
    queryBrisket: function() {
        var escaped = [];
        for (var name in chutney.txdata.tx_corp_names) {
            escaped.push(escape(name));
        }
        var query = escaped.join(",");
        $("body").ajaxError(function(e, xhr, settings, exception) {
            console.log(e);
            console.log(xhr);
            $("#chutneyContent").html("Error communicating with server.");
        });
        console.log("querying...");
        $.getJSON(SERVER_URL + "/search.json?q=" + query + "&callback=?", 
                 this.handleCorps);

    },
    /*
    *  Pull transactions and corporations out of the current page.
    */
    parseTransactions: function() {
        // mint 
        chutney.txdata.txs = [];
        chutney.txdata.tx_corp_names = {};
        $("#transaction-list-body > tr").each(function(index) {
            var desc = $(this).children("td[title]");
            var name = desc.text();
            chutney.txdata.txs.push({
                'name': name,
                'amount': dollarsToFloat($(this).children("td.money").text()),
                'date': $(this).children("td.date").text(),
                'orig': desc.attr("title"),
                'order': index
            });
            if (typeof chutney.txdata.tx_corp_names[name] == "undefined") {
                chutney.txdata.tx_corp_names[name] = 1;
            } else {
                chutney.txdata.tx_corp_names[name] += 1;
            }
        });
        console.log(chutney.txdata);
    },
    removeMatch: function(tx_order) {
        var txdata = chutney.txdata;
        var bad = {};
        /* TODO:
        *   * set up cookie
        *   * adjust totals, redraw totals graphs
        *   * change from a TX based id to a tx -> corp mapping
        *   * Nice long transition effect on removal/addition.
        *   * Add a corolary for adding mapping.
        */
        for (var i = 0; i < txdata.txs.length; i++) {
            if (txdata.txs[i].order == tx_order) {
                var tx = txdata.txs[i];
                if (!tx.corp) {
                    return;
                }
                bad[tx.name] = tx.corp.info.id;
                delete txdata.corps[tx.name];
                delete tx.corp;

                $(".tx" + tx.order).remove();
                var els = chutney.buildTxRow(tx);
                for (var i = 0; i < $("table.unmatched tr").length; i++) {
                    if ($(this).data('order') > tx_order) {
                        for (var j = 0; j < els.length; j++) {
                            $(this).before(els[i]);
                        }
                        break;
                    }
                }
                return;
            }

        }

    },
    /*
    *  Callback for corporation match and brisket queries.  Store data, then display.
    */
    handleCorps: function(data) {
        var txdata = chutney.txdata;
        txdata.matched = [];
        txdata.unmatched = [];
        txdata.corps = data.results;
        for (var i = 0; i < chutney.txdata.txs.length; i++) {
            var tx = txdata.txs[i];
            if (txdata.corps[tx.name] != undefined) {
                tx.corp = chutney.txdata.corps[tx.name];
                tx.corp.url = BRISKET_URL + "/organization/" + slugify(tx.corp.info.name) + 
                    "/" + tx.corp.info.id;
                if (tx.amount < 0) {
                    var pb = tx.corp.party_breakdown;
                    r = pb.Republicans != undefined ? parseFloat(pb.Republicans[1]) : 0;
                    d = pb.Democrats != undefined ? parseFloat(pb.Democrats[1]) : 0;
                    o = pb.Other != undefined ? parseFloat(pb.Other[1]) : 0;
                    var total = r + d + o;
                    tx.party_breakdown = {
                        'Republicans': tx.amount * (r / total),
                        'Democrats': tx.amount * (d / total),
                        'Other': tx.amount * (o / total)
                    };
                    txdata.totals.Republicans += tx.party_breakdown.Republicans;
                    txdata.totals.Democrats += tx.party_breakdown.Democrats;
                    txdata.totals.Other += tx.party_breakdown.Other;
                    txdata.totals.matched += tx.amount;
                    for (var j = 0; j < tx.corp.recipients.length; j++) {
                        var recipient = tx.corp.recipients[j];
                        if (txdata.totals.recipients[recipient.name] == undefined) {
                            txdata.totals.recipients[recipient.name] = 0;
                        }
                        val = parseFloat(recipient.total_amount);
                        txdata.totals.recipients[recipient.name] += val;
                        txdata.totals.all_recipients += val;
                        txdata.recipient_ids[recipient.name] = recipient.id;
                    }
                }
                txdata.matched.push(tx);
            } else {
                if (tx.amount < 0) {
                    txdata.totals.unmatched += tx.amount;
                }
                txdata.unmatched.push(tx);
            }
        }
        console.log(chutney.txdata);
        chutney.show();
    },
    /*
    *  Create the overlay that we will display things in.
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
            chutney.txdata = {
                tx_corp_names: {},
                txs: [],
                totals: {
                    Republicans: 0,
                    Democrats: 0,
                    Other: 0,
                    matched: 0,
                    unmatched: 0,
                    all_recipients: 0,
                    recipients: {}
                },
                recipient_ids: {},
            };
        }
    },
    buildTxRow: function(tx) {
        if (tx.corp) {
            var tr = $(document.createElement("tr"))
                      .attr('class', 'chutney-tx matched tx' + tx.order);
            tr.append($(document.createElement("td"))
                      .attr('class', 'date')
                      .html(tx.date));
            tr.append($(document.createElement("td"))
                      .attr('title', tx.orig)
                      .html(tx.name + 
                            ": <a class='match' href='" + tx.corp.url + "'>" + 
                                tx.corp.info.name + 
                            "</a> " +
                            "<span class='wrong-match'>(Is this the " +
                                "<a href='#' onclick='chutney.removeMatch(" 
                                          + tx.order + "); return false;'>" +
                                    "wrong match</a>?)</span>"
                           ));
            tr.append($(document.createElement("td"))
                      .attr('class', 'amount ' + (tx.amount > 0 ? "pos" : "neg"))
                      .html(floatToDollars(tx.amount)));

            var tx_breakdown_div = $(document.createElement("div"))
                                    .attr({
                                        'class': 'tx-party-breakdown',
                                        'id': "partyBreakdown" + tx.order,
                                        'rowspan': 2
                                    });
            tr.append($(document.createElement("td"))
                      .attr({
                          'class': 'party-breakdown',
                          'rowspan': 2
                      }).html(tx_breakdown_div));

            var pb = {};
            for (var party in tx.corp.party_breakdown) {
                pb[party] = parseFloat(tx.corp.party_breakdown[party][1]);
            }
            if (tx.amount < 0) {
                chutney.postLoadQueue.push(function() {
                    minipie(tx_breakdown_div.attr('id'), pb, "party");
                });
            }
            
            var issues = "Issues: " + tx.corp.issues_lobbied_for.join(", ");
            issues = issues.substring(0, 130) + 
                (issues.length > 100 ? "<a href='" + tx.corp.url + "'>...</a> &nbsp;" : "");
            issues += "<br />Politicians: ";
            var recipient_links = [];
            for (var i = 0; i < Math.min(tx.corp.recipients.length, 4); i++) {
                recipient_links.push("<a href='" + recipientUrl(tx.corp.recipients[i]) + "'>" +
                    tx.corp.recipients[i].name + "</a>");
            }
            issues += recipient_links.join(", ");

            var tr2 = $(document.createElement("tr"))
                .attr('class', 'chutney-issues tx' + tx.order)
                .append($(document.createElement("td"))
                        .attr({'colspan': 2})
                        .html(issues));
            return [tr, tr2];
        } else {
            return [$(document.createElement("tr")).attr('class', 'chutney-tx unmatched tx' + tx.order)
                .append($(document.createElement("td"))
                        .attr('class', 'date')
                        .html(tx.date))
                .append($(document.createElement("td"))
                        .attr({'class': 'orig', 'title': tx.orig})
                        .html(tx.name))
                .append($(document.createElement("td"))
                        .attr('class', 'amount ' + (tx.amount > 0 ? "pos" : "neg"))
                        .html(floatToDollars(tx.amount)))
                .data('order', tx.order)];
        }
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
    },
    drawTotals: function() {
        var partyBreakdown = {
            'Republicans': Math.abs(Math.round(chutney.txdata.totals.Republicans)),
            'Democrats': Math.abs(Math.round(chutney.txdata.totals.Democrats)),
            'Other': Math.abs(Math.round(chutney.txdata.totals.Other))
        };
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
        barchart("recipientTotals", recipientData);
        var total = Math.abs(chutney.txdata.totals.matched) + Math.abs(chutney.txdata.totals.unmatched);
        $("#matchedPercentage").html(
            Math.abs(Math.round((chutney.txdata.totals.matched / total) * 100))
        );
        $("#unmatchedPercentage").html(
            Math.abs(Math.round((chutney.txdata.totals.unmatched / total) * 100))
        );
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
    }
}

window.chutney = chutney;
console.log("Chutney done");

})();
