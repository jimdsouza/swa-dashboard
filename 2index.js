#!/usr/bin/env node
"use strict"

const osmosis = require("osmosis")
const chalk = require("chalk")
const rainbow = require("chalk-rainbow")
const twilio = require("twilio")
const blessed = require("blessed")
const contrib = require("blessed-contrib")
const format = require("date-format")
const pretty = require("pretty-ms")
const airports = require("airports")

// Time constants
const TIME_MS = 1
const TIME_SEC = TIME_MS * 1000
const TIME_MIN = TIME_SEC * 60
const TIME_HOUR = TIME_MIN * 60

// Fares
var prevLowestOutboundFare
var prevLowestReturnFare
const fares = {
  outbound: [],
  return: []
}

// Flight times
const flightTimes = {
  "anytime":   "ANYTIME",
  "morning":   "BEFORE_NOON",
  "afternoon": "NOON_TO_6PM",
  "evening":   "AFTER_6PM"
}

// Command line options
var originAirport = 'LAX'
var destinationAirport = 'EWR'
var outboundDateString = '5/5/2017'
var outboundTimeOfDay = flightTimes["anytime"]
var returnDateString = '6/6/2017'
var returnTimeOfDay = flightTimes["anytime"]
var adultPassengerCount = 1
var individualDealPrice 
var totalDealPrice 
var interval = 5 // In minutes
var fareType = 'DOLLARS'
var isOneWay = false
var isInternational = true

// Remove invalid fields for a one-way flight
// Doing this after all flags are parsed in the event
// flags are out of order
if (isOneWay) {
  returnDateString = ""
  returnTimeOfDay = ""
  totalDealPrice = undefined;
}

// Check if Twilio env vars are set
const isTwilioConfigured = process.env.TWILIO_ACCOUNT_SID &&
                           process.env.TWILIO_AUTH_TOKEN &&
                           process.env.TWILIO_PHONE_FROM &&
                           process.env.TWILIO_PHONE_TO

  

 /**
 * Send a text message using Twilio
 *
 * @param {Str} message
 *
 * @return {Void}
 */
const sendTextMessage = (message) => {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

    twilioClient.sendMessage({
      from: process.env.TWILIO_PHONE_FROM,
      to: process.env.TWILIO_PHONE_TO,
      body: message
    }, function(err, data) {
      if (err) {
        console.log([
          chalk.red(`Error: failed to send SMS to ${process.env.TWILIO_PHONE_TO} from ${process.env.TWILIO_PHONE_FROM}`)
        ])
      } else {
        console.log([
          chalk.green(`Successfully sent SMS to ${process.env.TWILIO_PHONE_TO} from ${process.env.TWILIO_PHONE_FROM}`)
        ])
      }
    })
  } catch(e) {}
}

/**
 * Format fare type price
 *
 * @param {Int} price
 *
 * @return {Str}
 */
const formatPrice = (price) => {
  //if (fareType === 'POINTS') {
  //  return `${price} pts`
  //} else {
    return `\$${price}`
  //}
}

/**
 * parse and return pricing from html markup
 *
 * @param {str} pricemarkup
 *
 * @return {int}
 */
const parsepricemarkup = (pricemarkup) => {
 // if (faretype === 'points') {
 //   const matches = pricemarkup.text().split(',').join('')
 //   return parseint(matches)
 // } else {
    const matches = pricemarkup.toString().match(/\$.*?(\d+)/)
    return parseInt(matches[1])
  //}
}

/**
 * Fetch latest Southwest prices
 *
 * @return {Void}
 */
const fetch = () => {
  const formData = {
  }

  osmosis
    .get("https://www.southwest.com")
    .submit(".booking-form--form", {
      twoWayTrip: !isOneWay,
      airTranRedirect: "",
      returnAirport: isOneWay ? "" : "RoundTrip",
      outboundTimeOfDay,
      returnTimeOfDay,
      seniorPassengerCount: 0,
      fareType,
      originAirport,
      destinationAirport,
      outboundDateString,
      returnDateString,
      adultPassengerCount
    })
    .find("#faresOutbound .product_price, #b0Table span.var.h5")
        .then((priceMarkup) => {
      const price = parsepricemarkup(priceMarkup)
      fares.outbound.push(price)
      console.log(['Price is $(price)'])
    })
    .find("#faresReturn .product_price, #b1Table span.var.h5")
    .log(console.log)
    .error(console.error)
    .then((priceMarkup) => {
      if (isOneWay) return // Only record return prices if it's a two-way flight
      const price = parsepricemarkup(priceMarkup)
      fares.return.push(price)
    })
    .done(() => {
      const lowestOutboundFare = Math.min(...fares.outbound)
      const lowestReturnFare = Math.min(...fares.return)
      var faresAreValid = true

      // Clear previous fares
      fares.outbound = []
      fares.return = []

      // Get difference from previous fares
      const outboundFareDiff = prevLowestOutboundFare - lowestOutboundFare
      const returnFareDiff = prevLowestReturnFare - lowestReturnFare
      var outboundFareDiffString = ""
      var returnFareDiffString = ""

      // Create a string to show the difference
      if (!isNaN(outboundFareDiff) && !isNaN(returnFareDiff)) {

        // Usually this is because of a scraping error
        if (!isFinite(outboundFareDiff) || !isFinite(returnFareDiff)) {
          faresAreValid = false
        }

        if (outboundFareDiff > 0) {
          outboundFareDiffString = chalk.green(`(down ${formatPrice(Math.abs(outboundFareDiff))})`)
        } else if (outboundFareDiff < 0) {
          outboundFareDiffString = chalk.red(`(up ${formatPrice(Math.abs(outboundFareDiff))})`)
        } else if (outboundFareDiff === 0) {
          outboundFareDiffString = chalk.blue(`(no change)`)
        }

        if (returnFareDiff > 0) {
          returnFareDiffString = chalk.green(`(down ${formatPrice(Math.abs(returnFareDiff))})`)
        } else if (returnFareDiff < 0) {
          returnFareDiffString = chalk.red(`(up ${formatPrice(Math.abs(returnFareDiff))})`)
        } else if (returnFareDiff === 0) {
          returnFareDiffString = chalk.blue(`(no change)`)
        }
      }

      if (faresAreValid) {
        // Store current fares for next time
        prevLowestOutboundFare = lowestOutboundFare
        prevLowestReturnFare = lowestReturnFare

        // Do some Twilio magic (SMS alerts for awesome deals)
        const awesomeDealIsAwesome = (
          totalDealPrice && (lowestOutboundFare + lowestReturnFare <= totalDealPrice)
        ) || (
          individualDealPrice && (lowestOutboundFare <= individualDealPrice || lowestReturnFare <= individualDealPrice)
        )

        if (awesomeDealIsAwesome) {
          const message = `Deal alert! Combined total has hit ${formatPrice(lowestOutboundFare + lowestReturnFare)}. Individual fares are ${formatPrice(lowestOutboundFare)} (outbound) and ${formatPrice(lowestReturnFare)} (return).`

          // Party time
          console.log([
            rainbow(message)
          ])

          if (isTwilioConfigured) {
            sendTextMessage(message)
          }
        }

        console.log(
          `Lowest fares for an outbound flight is currently ${formatPrice([lowestOutboundFare, outboundFareDiffString].filter(i => i).join(" "))}`
        )

        if (!isOneWay) {
          console.log(
            `Lowest fares for a return flight is currently ${formatPrice([lowestReturnFare, returnFareDiffString].filter(i => i).join(" "))}`,
            `Total for both flights is currently ${formatPrice(lowestOutboundFare + lowestReturnFare)}`
          )
        }

       
      }

      setTimeout(fetch, interval * TIME_MIN)
    })
}

fetch()
