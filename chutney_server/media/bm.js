(function() {

if (typeof window.console == "undefined") { console = { log: function() {} }; }
console.log("Brisket being read");
var scriptsInserted = false;
var stylesheets = [
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/themes/ui-lightness/jquery-ui.css"
];
var scripts = [
    "http://ajax.googleapis.com/ajax/libs/jquery/1.4/jquery.min.js",
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/jquery-ui.min.js",
];
var $;
var b = {
    start: function() {
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
            setTimeout("brisket.start()", 50);
        } else if (typeof window.jQuery.ui == 'undefined') {
            console.log("no jquery-ui");
            setTimeout("brisket.start()", 50);
        } else {
            console.log(jQuery);
            jQuery.noConflict();
            $ = jQuery;
            b.run();
        }
    },
    run: function() {
        console.log("Brisket run!");
        this.getCorps();

        var escaped = [];
        $(this.corps).each(function(index) {
            escaped.push(escape($(this).text()));
        });
        var query = escaped.join(",");
        var matches = $.getJSON("http://localhost:8000/search.json?q=" + 
                                query + "&callback=?", this.handleCorps);

    },
    getCorps: function() {
        var corps = [];
        $("#transaction-list-body > tr > td[title]").each(function(el) {
            corps.push($(this));
        });
        this.corps = corps;
        console.log(this.corps);
    },
    handleCorps: function(data) {
        var results = data.results;
        var display = "<ul>";
        for (var i = 0; i < results.length; i++) {
            if (results[i][1] != null) {
                display += "<li>" + results[i][0] + "=&gt;" + results[i][1] + "</li>";
            }
        }
        display += "</ul>";
        var div = $(document.createElement("div"));
        div.html(display);
        div.dialog();
    }
}
window.brisket = b;
console.log("Brisket done");

})();
