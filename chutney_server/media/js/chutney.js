(function() {

var SERVER_URL = "http://localhost:8000";

if (typeof window.console == "undefined") { console = { log: function() {} }; }
console.log("Chutney being read");
var scriptsInserted = false;
var stylesheets = [
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/themes/south-street/jquery-ui.css",
    SERVER_URL + "/media/css/style.css"
];
var scripts = [
    SERVER_URL + "/media/raphael-min.js",
    "http://ajax.googleapis.com/ajax/libs/jquery/1.4/jquery.min.js",
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/jquery-ui.min.js",
];
var $;
var spinner = "<img src='" + SERVER_URL + "/media/img/spinner.gif' alt='spinner' />";

/**
 * Util
 **/

function dollarsToFloat(dollars) {
    // WATCHOUT: unicode version of &ndash; here.
    dollars = dollars.replace("–", "-");
    dollars = dollars.replace("$", "");
    dollars = dollars.replace(",", "");
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
        $("#chutneyContent").html(spinner);
        chutney.div.dialog('open');
        chutney.getCorps();

        var escaped = [];
        for (var name in chutney.corp_names) {
            escaped.push(escape(name));
        }
        var query = escaped.join(",");
        $("#chutneyContent").ajaxError(function(e, xhr, settings, exception) {
            console.log(e);
            console.log(xhr);
            $(this).html("Error communicating with server.");
        });
        console.log("querying...");
        $.getJSON(SERVER_URL + "/search.json?q=" + query + "&callback=?", 
                 this.handleCorps);

    },
    /*
    *  Pull corporations out of the current page.
    */
    getCorps: function() {
        // mint 
        chutney.txs = [];
        chutney.corp_names = {};
        $("#transaction-list-body > tr").each(function(index) {
            var name = $(this).children("td[title]").text();
            chutney.txs.push({
                'name': name,
                'amount': dollarsToFloat($(this).children("td.money").text()),
                'date': $(this).children("td.date").text()
            });
            if (typeof chutney.corp_names[name] == "undefined") {
                chutney.corp_names[name] = 1;
            } else {
                chutney.corp_names[name] += 1;
            }
        });
    },
    /*
    *  Callback for corporation match and brisket queries.  Store data, then display.
    */
    handleCorps: function(data) {
        chutney.data = data;
        console.log(data);
        chutney.show();
    },
    /*
    *  Create the overlay that we will display things in.
    */
    setUp: function() {
        if (chutney.div == undefined) {
            chutney.div = $(document.createElement("div")).attr({'id': "chutney"});
            chutney.div.append($(document.createElement("div")).attr({'id': "chutneyContent"}));
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
    },
    /*
    *  Do that UI magic.
    */
    show: function() {
        chutney.setUp();
        var results = chutney.data.results;
        var matched = "";
        var unmatched = "";
        var spent_totals = {
            repub: 0,
            democ: 0,
            other: 0,
            matched: 0,
            unmatched: 0
        }
        for (var i = 0; i < chutney.txs.length; i++) {
            var tx = chutney.txs[i];
            if (results[tx.name] != undefined) {
                var info = results[tx.name];
                console.log(info);
                matched += "<tr class='chutney-tx matched'>" +
                        "<td class='date'>" + tx.date + "</td>" +
                        "<td class='orig'>" + 
                            tx.name + 
                            ": <span class='match'>" + info.info.name + "</span>" +
                        "</td>" +
                        "<td class='amount " + (tx.amount > 0 ? "pos" : "neg") + "'>" +
                            floatToDollars(tx.amount) + "</td>" +
                        "<td class='party-breakdown' rowspan='2'>" + 
                            info.party_breakdown +
                        "</td>" +
                    "</tr>" + 
                    "<tr class='chutney-issues'>" +
                        "<td colspan='2'> Issues: " + info.issues_lobbied_for.join(", ") + "</td>" +
                    "</tr>";
                if (tx.amount < 0) {
                    var r,d,o;
                    var pb = info.party_breakdown;
                    r = pb.Republicans != undefined ? parseFloat(pb.Republicans[1]) : 0;
                    d = pb.Democrats != undefined ? parseFloat(pb.Democrats[1]) : 0;
                    o = pb.Other != undefined ? parseFloat(pb.Other[1]) : 0;
                    var total = r + d + o;
                    spent_totals.repub += tx.amount * (r / total);
                    spent_totals.democ += tx.amount * (d / total);
                    spent_totals.other += tx.amount * (o / total);
                    spent_totals.matched += tx.amount;
                }
            } else {
                unmatched += "<tr class='chutney-tx unmatched'>" +
                        "<td class='date'>" + tx.date + "</td>" +
                        "<td class='orig'>" + tx.name + "</td>" +
                        "<td class='amount " + (tx.amount > 0 ? "pos" : "neg") + "'>" +
                            floatToDollars(tx.amount) + "</td>" +
                    "</tr>";
                if (tx.amount < 0) {
                    spent_totals.unmatched += tx.amount;
                }
            }
        }
        var out = "<div class='total-party-breakdown'>" + 
                spent_totals.repub + "," +
                spent_totals.democ + "," +
                spent_totals.other + "," +
            "</div>" +
            "<table class='chutney-txs' cellspacing=0>" + matched + "</table>" +
            "<h2>Unmatched</h2>" + 
            "(" + floatToDollars(Math.abs(spent_totals.unmatched)) + " out of " + 
              floatToDollars(Math.abs(spent_totals.unmatched + spent_totals.matched)) + " spent)" +
            "<table class='chutney-txs' cellspacing=0>" + unmatched + "</table>";

        $("#chutneyContent").html(out);
    }
}
window.chutney = chutney;
console.log("Chutney done");

})();
