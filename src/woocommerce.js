'use strict';

const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

let api;

function getApi() {
  if (!api) {
    api = new WooCommerceRestApi({
      url: process.env.WOOCOMMERCE_URL,
      consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
      version: 'wc/v3',
    });
  }
  return api;
}

function generateCouponCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'MGX-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function formatOrder(order) {
  const items = order.line_items.map(i => `${i.name} x${i.quantity} ($${i.price})`).join(', ');
  return `Order #${order.id} | Status: ${order.status} | Items: ${items} | Shipping to: ${order.shipping.address_1}, ${order.shipping.city}, ${order.shipping.state} ${order.shipping.postcode}`;
}

const toolDefinitions = [
  {
    name: 'get_order_by_email',
    description: 'Look up all orders for a customer by their email address. Returns order IDs, statuses, and line items.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Customer email address' },
      },
      required: ['email'],
    },
  },
  {
    name: 'get_order_by_id',
    description: 'Fetch a specific order by its order ID. Returns full order details including line items, status, and shipping address.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'get_tracking_info',
    description: 'Get the tracking number, carrier, and estimated delivery for a specific order.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'update_order_status',
    description: 'Change the status of an order. Valid statuses: pending, processing, on-hold, completed, cancelled, refunded, failed.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
        status: { type: 'string', description: 'New order status' },
      },
      required: ['orderId', 'status'],
    },
  },
  {
    name: 'update_shipping_address',
    description: 'Update the shipping address on an order. Only call this AFTER the customer has confirmed the new address in conversation.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
        address1: { type: 'string' },
        address2: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string', description: 'Two-letter state code, e.g. TX' },
        postcode: { type: 'string' },
        country: { type: 'string', description: 'Two-letter country code, default US' },
      },
      required: ['orderId', 'address1', 'city', 'state', 'postcode'],
    },
  },
  {
    name: 'resend_order_email',
    description: 'Resend the order confirmation or shipping notification email to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
        emailType: { type: 'string', enum: ['confirmation', 'shipping'], description: 'Which email to resend' },
      },
      required: ['orderId', 'emailType'],
    },
  },
  {
    name: 'add_order_note',
    description: 'Add an internal note to an order. Use this to log any CS action taken (address change, coupon sent, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'WooCommerce order ID' },
        note: { type: 'string', description: 'Note content' },
      },
      required: ['orderId', 'note'],
    },
  },
  {
    name: 'create_coupon_code',
    description: 'Generate a new WooCommerce discount coupon for the customer. Returns the coupon code to share with them.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'Discount amount in dollars, e.g. "10"' },
        expiryDays: { type: 'number', description: 'Days until coupon expires, e.g. 30' },
      },
      required: ['amount'],
    },
  },
];

async function handleToolCall(toolName, input) {
  const wc = getApi();
  try {
    switch (toolName) {
      case 'get_order_by_email': {
        const { data } = await wc.get('orders', { email: input.email, per_page: 5 });
        if (!data || data.length === 0) return `No orders found for ${input.email}.`;
        return data.map(formatOrder).join('\n');
      }

      case 'get_order_by_id': {
        const { data } = await wc.get(`orders/${input.orderId}`);
        return formatOrder(data);
      }

      case 'get_tracking_info': {
        const { data } = await wc.get(`orders/${input.orderId}`);
        const trackingMeta = data.meta_data.find(m => m.key === '_wc_shipment_tracking_items');
        if (!trackingMeta || !trackingMeta.value) return `No tracking info found for order #${input.orderId}.`;
        const items = JSON.parse(trackingMeta.value);
        if (!items.length) return `No tracking info found for order #${input.orderId}.`;
        const t = items[0];
        return `Tracking: ${t.tracking_number} via ${t.tracking_provider}${t.date_shipped ? ` (shipped ${t.date_shipped})` : ''}.`;
      }

      case 'update_order_status': {
        await wc.put(`orders/${input.orderId}`, { status: input.status });
        return `Order #${input.orderId} status updated to ${input.status}.`;
      }

      case 'update_shipping_address': {
        const shipping = {
          address_1: input.address1,
          address_2: input.address2 || '',
          city: input.city,
          state: input.state,
          postcode: input.postcode,
          country: input.country || 'US',
        };
        await wc.put(`orders/${input.orderId}`, { shipping });
        await wc.post(`orders/${input.orderId}/notes`, {
          note: `CS Agent updated shipping address to: ${input.address1}, ${input.city}, ${input.state} ${input.postcode}`,
          customer_note: false,
        });
        return `Shipping address on order #${input.orderId} updated successfully.`;
      }

      case 'resend_order_email': {
        // WooCommerce REST API does not have a native resend endpoint.
        // This returns a message to Claude so it can inform the customer;
        // actual resend requires a custom WC action hook or plugin.
        return `Note: automatic email resend is not available via the API. Tell the customer you have flagged their request and our team will resend the ${input.emailType} email manually.`;
      }

      case 'add_order_note': {
        await wc.post(`orders/${input.orderId}/notes`, {
          note: `[CS Agent] ${input.note}`,
          customer_note: false,
        });
        return `Note added to order #${input.orderId}.`;
      }

      case 'create_coupon_code': {
        const code = generateCouponCode();
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + (input.expiryDays || 30));
        const expiryStr = expiry.toISOString().split('T')[0];

        await wc.post('coupons', {
          code,
          discount_type: 'fixed_cart',
          amount: input.amount,
          date_expires: expiryStr,
          individual_use: true,
          usage_limit: 1,
        });

        return `Coupon created: ${code} -- $${input.amount} off, expires ${expiryStr}.`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Tool error (${toolName}): ${err.message}`;
  }
}

module.exports = { toolDefinitions, handleToolCall };
