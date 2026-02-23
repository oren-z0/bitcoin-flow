
# Bitcoin Flow Spec

Create a react-flow project to represent bitcoin transactions

Each node represents a bitcoin transaction.
Each edge represents a connection between a transaction output and a transaction input.

The graph will be horizontal, from left to right.

The information about the transactions should be fetched from the mempool.space API.

Don't use any paid features of react-flow.

Use Tailwind CSS for styling.

## Global state:

Global state should be saved in the localStorage of the browser, and have the following structure:

- transactions: a mapping from txid to an object with:
  - coordinates: an object with x and y coordinates.
  - data from mempool.space api
  - name (optional): a human-readable name for the transaction
  - color (optional): a hex color for the transaction
- addresses: a mapping from address to an object with:
  - name (optional): a human-readable name for the address
  - color (optional): a hex color for the address.
  - isSelected (boolean): whether the address is selected
- selectedTxid (optional): the txid of the selected transaction

For performance reasons, keep a global set called selectedAddresses that contains the addresses that are selected.

A global autoLayout boolean should decide whether we re-organize the layout when a new transaction is added or removed from the global state. See Auto-Layout section below.

Notice that for the transactions' data from mempool.space, you will also need to fetch the transactions' outspends, to know if the ouputs are spent or not and by which transaction.

If possible, listen to new blocks arriving to the blockchain and update transactions whose mining state is unconfirmed, and recheck outspends that might have appeared for unspent outputs. Don't do polling, if mempool.space doesn't provide a websocket-based api to know when a new block is mined, we can skip this feature (the user will have to manually refresh the page to see the latest updates).

When the app is loaded, load the global state from the localStorage - iterate over the transactions and recheck the outspends that might have appeared for unspent outputs.

## Node styling

The react-flow handles (the point where the edge is connected to the node) should be on the left and right side of the node.
On the left, the handles are the transaction inputs, and on the right, the handles are the transaction outputs.

At the top of each node (inside it), display the txid first four hexdigits, followed by "..." and then the last four hexdigits. If the transaction has a name, display it instead of the txid, and if it has a color, use it for the text color.

Near each input handle (which is on the left side of the node), display an input-label with two lines (from the inside of the node):
First line: scriptpubkey_address of the input: the first four letters, followed by "...", and then the last four letters. For example: 157H...euVC. If the address has a name, display it instead of the address, and if it has a color, use it for the text color.
Second line: The value of the input (in BTC, not sats), with 8 decimal places. For example: 0.12340001

Near each output handle (which is on the right side of the node), display an output-label with two lines (from the inside of the node):
First line: scriptpubkey_address of the output: the first four letters, followed by "...", and then the last four letters. For example: 157H...euVC. If the address has a name, display it instead of the address, and if it has a color, use it for the text color.
Second line: The value of the output (in BTC, not sats), with 8 decimal places. For example: 0.12340001
If this is an OP_RETURN output (with zero amount), display "OP_RETURN" instead of the lines.
When the output points to to an existing transaction, the handle should have a red color (255, 61, 0).
When there is no transaction associated with the output, the handle should have a green color (10, 171, 47).
OP_RETURN output handles should be gray.

At the bottom of the node (inside it) there should be the fee rate: "Fee: X sat/vB" with fee/weight, in a two digit percision. For example: "Fee: 12.34 sat/vB".

Below each node, display two text lines: the block height, and below it the timestamp in which the block was mined. If the transaction has not been mined yet, the node should blink (animate), and the text below it should say "Unconfirmed". The blinking opacity should be subtle, like 70%.

Make the node style nice, like rounded corners, and a subtle shadow. Handles should be spread evenly in their side (if that's not too complicated).
If the transaction has a color, use it for the node border.

When the node's transaction is the selected transaction, its border should be bolded.

When one of the transaction's inputs' addresses or outputs' addresses are in the selectedAddresses set, the handle with that address should be bolded.

Clicking a node (and not dragging it) should select the transaction.

Clicing the handle-label of each input/output handle should open the side panel in the Addresses tab, in the mode that shows the address details (If it's not in global-state addresses, it should be added).

Clicking on an empty area should unset selectedTxid (but keep the selected-addresses as they are).

Nodes should be draggable. When the dragging start, autoLayout should be set to false. Dragging a node should not be treated as a selection.

Clicking an input/output handle should add the other transactions associated with the input/output - i.e. the vin transaction in case of an input, and outspend transaction in case of an output.

## Special cases

There should be at most 4 input handles. If there are more inputs, some handle might represent multiple inputs. The rules in this case are:

- If none of the inputs have addresses with custom names, display "X inputs" as a single handle.
- If up to 3 inputs have addresses with custom names, display each of them as a separate handle, and the rest should be displayed as a single handle with the label "X other inputs".
- If more than 3 inputs have addresses with custom names, then:
  - If all the inputs have the same address, display "X inputs: {address-name}". Otherwise display "X labeled inputs".
  - If there are less than 3 other inputs (without custom names), show each one in a separate handle. Otherwise show "X other inputs". If there are no other inputs, there is no handle to show.

The second text-line of an input-label that represnts multiple inputs should show the total amount of Bitcoin in its inputs.

Typically we would want the order of the inputs to be according to their order in the vin array (from top to bottom). If multiple inputs are represented by a single handle, we can ignore this rule.

Similarly, there should be at most 4 output handles. If there are more outputs, some handle might represent multiple outputs. The rules in this case are:
- If none of the outputs have addresses with custom names, display "X outputs" as a single handle.
- If up to 3 outputs have addresses with custom names, display each of them as a separate handle, and the rest should be displayed as a single handle with the label "X other outputs".
- If more than 3 outputs have addresses with custom names, then:
  - If all the outputs have the same address, display "X outputs: {address-name}". Otherwise display "X labeled outputs".
  - If there are less than 3 other outputs (without custom names), show each one in a separate handle. Otherwise show "X other outputs". If there are no other outputs, there is no handle to show.

The second text-line of an output-label that represnts multiple outputs should show the total amount of Bitcoin in its outputs.

For an input/output label that represnts multiple inputs/outputs, when one of the the addresses that it represents is in the selectedAddresses set, the handle should be bolded.

If a handle-label represents multiple addresses (whether it's an input or an output), and some of the addresses have custom colors, the color of the handle-label should be an animation switching between those colors.

## Edge styling

The stroke-width of the each edge should be between 2px and 8px, depending on its Bitcoin amount of the transaction output/input that it connects to.
The edge with the minimal amount should be 2px. The edge with the maximal amount should be 8px. The other edges should have a stroke-width between 2px and 8px, depending on the ratio of the amount to the minimal and maximal amount, logarithmically (log scale).

Each edge is associated with an address, taken from the vout info of the transaction output. If the address has a color, use it for the edge color. If that address is in the selectedAddresses set, the edge should have a simple glow effect (like a shadow effect or a halo effect).

# Side Panel

On the right side of the screen, there should be a sidebar/side-panel for multiple features.

## Case 1: selectedTxid is not set

Sohuld have throw tabs: Transactions, Addresses, Settings.

### Transactions tab

A text input should allow to add transactions manually by entering their txid. See Adding Transaction section.

Should show the list of transactions that are in the global state:
- title: name (if any) or txid. If the color is set, the title should be in that color.
- txid: Only displayed if the title comes from a custom name (smaller text, gray color).
- block-timestamp (or unconfirmed).

Clicking a transaction should update selectedTxid, and focus on the node representing the transaction (without changing zoom level).

A "Load Multiple Transactions" button with a description "Upload a CSV file with the columns: txid, name, hex-color (optional)".
There should also be a "Download Transactions" button that downloads a CSV file with the columns: txid, name, hex-color (if set).

### Addresses tab

A text input should allow to add addresses manually. If possible, use autocomplete when a prefix is entered, the same way it is implemented in mempool.space website.

Should show the list of addresses that we've loaded:
- Checkbox to select/deselect the address.
- title: name (if any) or address. If the color is set, the title should be in that color.
- address: Only displayed if the title comes from a custom name (smaller text, gray color).

There should be a Deselect All button, above the list.

Clicking the address title itself (not the checkbox) should change the mode to show the address details, and replace the Address tab content with the address details:
- A Back button should return the Addresses tab to a normal state.
- Selected/Unselected switch to toggle the address selection.
- Address: show the address itself.
- Name input box (leave empty to unset the name, and revert back to the default behavior)
- Color picker to change the color (with an option to unset and revert back to the default behavior).
- Delete button to remove the address from the list.
- A list of trnasactions associated with the address, from the mempool.space API, with pagination mechanism. The list should be in a scrollable box because it can be long (and we don't want to make the user scroll endlessly just to reach the buttons below the list). Each address line show show:
  - title, txid, block-timestamp (or unconfirmed), in the same style as the Transactions tab.
  - If the transaction is not in the global state transactions, an "Add" button should be shown to add it to the global state.
- If at least one transaction is associated with the address, a button saying "Add (all) X transaction(s)" should be shown. Clicking it should add all the transactions associated with the address to the global state (all the transactions that are not already in the global state). If autoLayout is true, apply the Auto-Layout algorithm only AFTER all the transactions are added (See Adding Transaction and Auto-Layout section below).
- A button saying "Open in Mempool.space" should open the address in a new tab in the mempool.space website.

### Settings tab

Should show global settings for the app/website.

- Auto-layout: a switch to toggle the autoLayout boolean. When the auto-layout switch is toggled on, apply the Auto-Layout algorithm (See Auto-Layout section below).
- Download State: a button that downloads the global state (transactions, addresses, selectedTxid, selectedAddresses) as a JSON file.
- Upload State: a button that uploads a JSON file that contains the global state (transactions, addresses, selectedTxid, selectedAddresses). The new data should be merged with the existing data. If Auto-layout is true, apply the Auto-Layout algorithm (See Auto-Layout section below).
- Clear State: a button that clears the global state.

# Case 2: selectedTxid is set

The side panel should show the transaction details:

- Txid: show the transaction details.
- Name: Editable text input to change the name of the transaction.
- Inputs: show a list of the inputs details:
  - transaction title (name if any, or txid). Clicking the title should add the associated transactions to the global state (see Adding Transaction section), and if it's already in the global state focus on the node representing the transaction (without changing zoom level) - and then update selectedTxid to the new transaction.
  - address (name if any, or address). Clicking the address should open the side panel in the Addresses tab, in the mode that shows the address details (If it's not in global-state addresses, it should be added).
  - value (in BTC, not sats, with 8 decimal places).
- Outputs: show a list of the outputs details:
  - If this is a spent output, show the transaction title (name if any, or txid) in green (10, 171, 47). Clicking the title should add the associated transactions to the global state (see Adding Transaction section), and if it's already in the global state focus on the node representing the transaction (without changing zoom level) - and then update selectedTxid to the new transaction. If this is a UTXO, show "UTXO" in red (255, 61, 0).
  - address (name if any, or address). Clicking the address should open the side panel in the Addresses tab, in the mode that shows the address details (If it's not in global-state addresses, it should be added).
  - value (in BTC, not sats, with 8 decimal places). "OP_RETURN" if it's an OP_RETURN output with no amount.
- Below there should be the general details of the transaction, similar to the Details section in the mempool.space website: Size, Weight, Version, Locktime.
- Below there should be a button saying "Open in Mempool.space" that opens the transaction in a new browser tab in the mempool.space website.

# Adding Transaction

In addition to adding the transaction to the global state, we also need to calculate their X and Y coordinates.

The transactions should be sorted by block-height, and if two transactions have the same block-height, they should be sorted by txid. Then the new node X coordinates should be calculated based on their position in the sorted list - the average of the X cooridnates of its neighbors in the sorted list. If it's the first, the X coordinates should be the X coordinate of the second transaction minus a reasonable distance. If it's the last, the X coordinates should be the X coordinate of the second last transaction plus a reasonable distance. The Y cooridnates should be the middle of the view currently displayed.
If autoLayout is true, the Auto-Layout algorithm should be applied (See Auto-Layout section below).
After the Auto-Layout completes (or if autoLayout was false), focus the view on the new node (without changing zoom level).

## Auto-Layout

For the X coordinates, the transactions should be sorted by block-height, and if two transactions have the same block-height, they should be sorted by txid. Then each one should be given X coordinates following this order, so there will be a reasonable distance between each two consecutive transactions.
For example if we have 5 transactions, and a reasonable distance is 100px, the X coordinates calculation should be [0, 100, 200, 300, 400]. Then, calculate the average of the first and last X coordinates ((0 + 400) / 2 = 200), and reduce the value from each element, to give: [-200, -100, 0, 100, 200].

For the Y coodinates, use the elkjs library. Don't use react-flow's internal autoLayout mechanism, because this feature costs money. I've read that it can be implemented without the paid feature, but let me know if this is not the case.

If not too complicated, the nodes should move smoothly to their new positions, with an animation duration that should be more than a few seconds.
