const scraper = require("form-scraper")
const pRequest = require("promisified-request").create();

var data={}

const test = () => {
    scraper
     data =  scraper.fetchForm(".multicity", "https://www.kayak.com/flights", pRequest)
     console.log(data)
}

test()
