// Browser sessions use ordinary Site identity. The public /mcp transport retains
// its gateway OAuth requirement. Both transports run the same tool handler and
// resolve current membership for every data or preparation call.
export {POST,GET,DELETE} from '@/app/mcp/route';
