(function($) {
    $.fn.textNodes = function() {
        var ret = [];
        this.contents().each( function() {
            var fn = arguments.callee;
                try {
                    if ( this.nodeType == 3 || $.nodeName(this, "br") ) 
                        ret.push( this );
                    else if (!$.nodeName(this, "script") && !$.nodeName(this, "style")) $(this).contents().each(fn);
                } catch(e) {}
        });
        return $(ret);
    };
    $.fn.anonymizeNumbers = function() {
        $.each($(this).textNodes(), function() { this.nodeValue && (this.nodeValue = this.nodeValue.replace(/[,\d]+\.\d{2}/g, '1.00').replace(/\d{5,}/g, '1')); })
    }
}(jQuery))